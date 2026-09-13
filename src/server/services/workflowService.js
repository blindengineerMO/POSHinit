import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { enqueueDispatch, getDispatch } from './jobQueueService.js'
import { syncInventorySource } from './inventorySourceService.js'
import { dispatchNotificationEvent } from './notificationPolicyService.js'
import { requestWorkflowApproval } from './approvalService.js'
import { recordAudit } from './auditService.js'

const nodeTypes = new Set(['runbook', 'inventory-sync', 'condition', 'parallel', 'wait', 'approval', 'notification', 'retry', 'rollback'])
const terminal = new Set(['completed', 'failed', 'cancelled'])
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function json(value, fallback = {}) { try { return JSON.parse(value || '') } catch { return fallback } }
function resolve(value, context) { if (typeof value !== 'string') return value; return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key) => key.split('.').reduce((current, part) => current?.[part], context) ?? '') }

export function validateWorkflowGraph(graph = {}) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []; const edges = Array.isArray(graph.edges) ? graph.edges : []; const ids = new Set(nodes.map((node) => node.id)); const errors = []
  if (!nodes.length) errors.push('A workflow needs at least one node')
  nodes.forEach((node) => { if (!node.id || !nodeTypes.has(node.type)) errors.push(`Node ${node.id || 'without an id'} has an unsupported type`); if (node.type === 'runbook' && (!node.config?.scriptIds?.length || !node.config?.machineIds?.length)) errors.push(`Runbook node ${node.label || node.id} needs runbooks and targets`); if (node.type === 'inventory-sync' && !node.config?.sourceId) errors.push(`Inventory sync node ${node.label || node.id} needs a source`) })
  edges.forEach((edge) => { if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push('Every edge must connect existing nodes') })
  const visit = (id, seen = new Set(), stack = new Set()) => { if (stack.has(id)) return true; if (seen.has(id)) return false; seen.add(id); stack.add(id); const loop = edges.filter((edge) => edge.from === id).some((edge) => visit(edge.to, seen, stack)); stack.delete(id); return loop }
  if (nodes.some((node) => visit(node.id))) errors.push('Workflow graphs cannot contain cycles')
  return { ok: !errors.length, errors }
}

function mapTemplate(template) { return { ...template, graph: json(template.graph_json, { nodes: [], edges: [] }) } }
export function listWorkflowTemplates() { return all('SELECT * FROM workflow_templates ORDER BY updated_at DESC').map(mapTemplate) }
export function saveWorkflowTemplate(payload = {}, userId) { const graph = payload.graph || { nodes: [], edges: [] }; const validation = validateWorkflowGraph(graph); if (!validation.ok) throw new Error(validation.errors.join('; ')); const id = payload.id || nanoid(); const timestamp = nowIso(); const existing = payload.id ? get('SELECT created_at FROM workflow_templates WHERE id = ?', [payload.id]) : null; run(`INSERT INTO workflow_templates (id,name,description,project_id,environment_id,graph_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,project_id=excluded.project_id,environment_id=excluded.environment_id,graph_json=excluded.graph_json,updated_at=excluded.updated_at`, [id, String(payload.name || 'Untitled workflow').trim(), String(payload.description || ''), payload.projectId || 'project-default', payload.environmentId || 'env-default', JSON.stringify(graph), existing ? null : userId || null, existing?.created_at || timestamp, timestamp]); recordAudit({ actorId: userId, action: 'workflow.template.saved', resourceType: 'workflow', resourceId: id, context: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length } }); return mapTemplate(get('SELECT * FROM workflow_templates WHERE id = ?', [id])) }
export function deleteWorkflowTemplate(id, userId) { run('DELETE FROM workflow_templates WHERE id = ?', [id]); recordAudit({ actorId: userId, action: 'workflow.template.deleted', resourceType: 'workflow', resourceId: id }) }
function mapRun(row) { if (!row) return null; return { ...row, inputs: json(row.inputs_json), outputs: json(row.outputs_json), nodes: all('SELECT * FROM workflow_node_runs WHERE workflow_run_id = ? ORDER BY created_at', [row.id]).map((node) => ({ ...node, input: json(node.input_json), output: json(node.output_json) })) } }
export function listWorkflowRuns(templateId = '') { return all(`SELECT * FROM workflow_runs ${templateId ? 'WHERE template_id = ?' : ''} ORDER BY created_at DESC LIMIT 100`, templateId ? [templateId] : []).map(mapRun) }
export function getWorkflowRun(id) { return mapRun(get('SELECT * FROM workflow_runs WHERE id = ?', [id])) }

async function executeNode(runId, node, context) {
  const startedAt = nowIso(); const config = node.config || {}; const input = Object.fromEntries(Object.entries(config.inputs || {}).map(([key, value]) => [key, resolve(value, context)])); const nodeRunId = nanoid(); run('INSERT OR REPLACE INTO workflow_node_runs (id,workflow_run_id,node_id,node_type,status,attempt,input_json,output_json,started_at,created_at,updated_at) VALUES (?,?,?,?,\'running\',1,?,?,?, ?,?)', [nodeRunId, runId, node.id, node.type, JSON.stringify(input), '{}', startedAt, startedAt, startedAt])
  try {
    let output = {}
    if (node.type === 'runbook') { const dispatch = enqueueDispatch({ scriptIds: config.scriptIds, machineIds: config.machineIds, triggerType: 'workflow', retryLimit: config.retryLimit || 0, ...input }, context.requestedBy, { idempotencyKey: `${runId}:${node.id}` }); let live = getDispatch(dispatch.id); while (live && !terminal.has(live.status)) { await sleep(500); live = getDispatch(dispatch.id) } if (!live || live.status !== 'completed') throw new Error(`Runbook dispatch ${live?.status || 'not found'}`); output = { dispatchId: dispatch.id, status: live.status } }
    else if (node.type === 'inventory-sync') output = await syncInventorySource(config.sourceId)
    else if (node.type === 'wait') { await sleep(Math.min(3600000, Math.max(0, Number(config.seconds || 0) * 1000))); output = { waitedSeconds: Number(config.seconds || 0) } }
    else if (node.type === 'condition') output = { result: String(resolve(config.left || '', context)) === String(resolve(config.equals || '', context)) }
    else if (node.type === 'approval') { const approval = requestWorkflowApproval(runId, node.id, context.requestedBy, config); let current = approval; while (current.status === 'pending') { await sleep(1000); current = get('SELECT * FROM approvals WHERE id = ?', [approval.id]) } if (current.status !== 'approved') throw new Error(`Approval node ${current.status}`); output = { approvalId: approval.id, status: current.status } }
    else if (node.type === 'notification') { await dispatchNotificationEvent({ type: config.eventType || 'job.success', title: resolve(config.title || 'Workflow notification', context), summary: resolve(config.summary || '', context), url: `/workflows?run=${runId}`, details: { workflowRunId: runId, nodeId: node.id } }); output = { delivered: true } }
    else output = { mode: node.type, message: node.type === 'parallel' ? 'Parallel branch join passed' : node.type === 'retry' ? 'Retry policy delegated to runbook dispatch' : 'Compensation node recorded' }
    run("UPDATE workflow_node_runs SET status='completed',output_json=?,finished_at=?,updated_at=? WHERE workflow_run_id=? AND node_id=?", [JSON.stringify(output), nowIso(), nowIso(), runId, node.id]); return { status: 'completed', output }
  } catch (error) { run("UPDATE workflow_node_runs SET status='failed',error_message=?,finished_at=?,updated_at=? WHERE workflow_run_id=? AND node_id=?", [error.message, nowIso(), nowIso(), runId, node.id]); return { status: 'failed', error: error.message } }
}

async function executeWorkflow(runId, template, requestedBy) {
  const graph = template.graph; const nodes = graph.nodes; const edges = graph.edges; const remaining = new Map(nodes.map((node) => [node.id, new Set(edges.filter((edge) => edge.to === node.id).map((edge) => edge.from))])); const completed = new Set(); const context = { inputs: getWorkflowRun(runId).inputs, outputs: {}, requestedBy }; let failed = null
  while (completed.size < nodes.length && !failed) { const ready = nodes.filter((node) => !completed.has(node.id) && [...remaining.get(node.id)].every((id) => completed.has(id))); if (!ready.length) { failed = 'No executable workflow nodes remain'; break }
    const results = await Promise.all(ready.map(async (node) => ({ node, result: await executeNode(runId, node, context) })))
    results.forEach(({ node, result }) => { completed.add(node.id); context.outputs[node.id] = result.output || {}; if (result.status === 'failed') failed = result.error; if (node.type === 'condition') edges.filter((edge) => edge.from === node.id && edge.when && Boolean(result.output?.result) !== (edge.when === 'true')).forEach((edge) => completed.add(edge.to)) })
  }
  const status = failed ? 'failed' : 'completed'; run('UPDATE workflow_runs SET status=?,outputs_json=?,error_message=?,finished_at=?,updated_at=? WHERE id=?', [status, JSON.stringify(context.outputs), failed, nowIso(), nowIso(), runId]); recordAudit({ actorId: requestedBy, actorType: 'worker', action: `workflow.run.${status}`, resourceType: 'workflow_run', resourceId: runId, outcome: status, context: { templateId: template.id, nodeCount: completed.size, error: failed } })
}

export function startWorkflowRun(templateId, inputs = {}, requestedBy) { const template = mapTemplate(get('SELECT * FROM workflow_templates WHERE id = ?', [templateId])); if (!template) throw new Error('Workflow template was not found'); const validation = validateWorkflowGraph(template.graph); if (!validation.ok) throw new Error(validation.errors.join('; ')); const timestamp = nowIso(); const id = nanoid(); run('INSERT INTO workflow_runs (id,template_id,status,inputs_json,outputs_json,requested_by,started_at,created_at,updated_at) VALUES (?,?,\'running\',?,?,?, ?,?,?)', [id, templateId, JSON.stringify(inputs), '{}', requestedBy || null, timestamp, timestamp, timestamp]); void executeWorkflow(id, template, requestedBy); return getWorkflowRun(id) }
