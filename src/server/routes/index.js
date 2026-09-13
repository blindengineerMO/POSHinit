import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { config } from '../config.js'
import { all, get } from '../db/client.js'
import { requireAuth, requirePermission, requireResourcePermission } from '../middleware/auth.js'
import { login, recordLogout } from '../services/authService.js'
import { getCatalog } from '../services/catalogService.js'
import { getDashboardSummary } from '../services/dashboardService.js'
import { buildTargetMachines, executeApprovedSchedule } from '../services/executionService.js'
import { decideApproval, listApprovalPolicies, listApprovals, saveApprovalPolicy } from '../services/approvalService.js'
import { explainDynamicGroup, listGroupMembershipChanges, listGroups, previewDynamicGroup, saveGroup } from '../services/groupService.js'
import { deleteLibraryEntry, getLibraryAsset, getLibraryPreview, importLibraryFile, listLibrary, listScriptVersions, saveLibraryEntry } from '../services/libraryService.js'
import { createRunbookRelease, getReleaseArtifact, getReleasePolicy, listRunbookReleases, reviewRunbookRelease, saveReleasePolicy, transitionRunbookRelease } from '../services/runbookReleaseService.js'
import { searchLogs } from '../services/logService.js'
import { listMachines, saveCredential, saveMachine, testMachineCandidate, testMachineConnection, uploadAsset } from '../services/machineService.js'
import { getSubnetScan, importSubnetScan, startSubnetScan } from '../services/subnetScanService.js'
import { getRemoteSessionSettings, getSettings, saveAuditSettings, saveEntraSettings, saveNotificationSettings, saveRemoteSessionSettings, saveSecretProviderSettings, saveSettings } from '../services/settingsService.js'
import { getScheduleWebhook, getScheduleWebhookStatus, getWebhookSchedule, listSchedules, saveSchedule } from '../services/scheduleService.js'
import { listTeams, saveTeam } from '../services/teamService.js'
import { listUsers, saveUser } from '../services/userService.js'
import { discoverVmwareMachines, importVcenterMachines, importVmwareMachines, importVmwareSelection, saveVcenterSettings } from '../services/vcenterService.js'
import { discoverAzureArcMachines, importAzureArcSelection, saveAzureArcSettings } from '../services/azureArcService.js'
import { discoverProxmoxMachines, importProxmoxSelection, saveProxmoxSettings } from '../services/proxmoxService.js'
import { validatePowerShell } from '../services/powershellService.js'
import { auditTerminalClipboard, brokeredSessionLaunch, cancelTerminalCommand, connectTerminal, disconnectTerminal, listTerminalTranscript, runTerminalCommand, streamTerminalCommand, terminalTransferGuard } from '../services/terminalService.js'
import { encryptSecret } from '../utils/crypto.js'
import { beginEntraSignIn, consumeEnterpriseTicket, enterpriseFailureRedirect, enterpriseSignInFailure, entraStatus, finishEntraSignIn } from '../services/entraService.js'
import { deleteNotificationPolicy, listNotificationPolicies, saveNotificationPolicy, setNotificationPolicyEnabled, testNotificationPolicy } from '../services/notificationPolicyService.js'
import { downloadDispatchOutput, enqueueDispatch, getDispatch, getReliabilityStatus, listDeadLetters, listDispatchEvents, requeueDeadLetter, requestDispatchCancellation, subscribeDispatch, tailDispatchOutput } from '../services/jobQueueService.js'
import { assertDispatchPermissions, assertResourcePermission, deleteAccessGrant, listAccessGrants, listScopeHierarchy, saveAccessGrant } from '../services/rbacService.js'
import { listParameterSets, saveParameterSet } from '../services/parameterService.js'
import { deleteCmdbEnrichmentSource, listCmdbEnrichmentRuns, listCmdbEnrichmentSources, saveCmdbEnrichmentSource, syncCmdbEnrichmentSource } from '../services/cmdbEnrichmentService.js'
import { deleteProject, projectHierarchy, saveEnvironment, saveProject } from '../services/projectService.js'
import { listAuditEvents, recordAudit, verifyAuditChain } from '../services/auditService.js'
import { ensureManagedInventorySources, listInventorySourceErrors, listInventorySourceHistory, listInventorySources, syncInventorySource, updateInventorySource } from '../services/inventorySourceService.js'
import { deleteWorkflowTemplate, getWorkflowRun, listWorkflowRuns, listWorkflowTemplates, saveWorkflowTemplate, startWorkflowRun, validateWorkflowGraph } from '../services/workflowService.js'
import { aiAssistPreview, confirmRecommendation, listRecommendations } from '../services/recommendationService.js'
import { completeWorkerTarget, heartbeat, listWorkerPools, listWorkers, pollWorker, registerWorker, saveWorkerPool, setWorkerDrain } from '../services/workerControlService.js'
import { evidenceBundle, exportReportArtifact, generateReport, getReportArtifact, listReportArtifacts, listReportSchedules, reportingDashboard, saveReportSchedule, setReportLegalHold } from '../services/reportingService.js'

const upload = multer({
  dest: path.join(config.uploadsDir),
})

export function createRouter() {
  const router = express.Router()

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'poshinit' })
  })

  router.post('/auth/login', (req, res) => {
    res.json(login(req.body, { ip: req.ip }))
  })

  router.get('/auth/entra/status', (_req, res) => {
    res.json(entraStatus())
  })

  router.get('/auth/entra/start', async (req, res, next) => {
    try {
      res.redirect(await beginEntraSignIn({ ip: req.ip }))
    } catch (error) {
      next(error)
    }
  })

  router.get('/auth/entra/callback', async (req, res) => {
    try {
      const result = await finishEntraSignIn({ code: req.query.code, state: req.query.state }, { ip: req.ip })
      res.redirect(result.redirectUrl)
    } catch (error) {
      enterpriseSignInFailure(error, { ip: req.ip })
      res.redirect(enterpriseFailureRedirect())
    }
  })

  router.post('/auth/entra/complete', (req, res) => {
    res.json(consumeEnterpriseTicket(req.body.ticket))
  })

  router.post('/webhooks/execute', async (req, res) => {
    const secret = req.headers['x-poshinit-webhook-secret'] || req.body.secret
    if (secret !== config.webhookSecret) {
      res.status(401).json({ error: 'Invalid webhook secret' })
      return
    }

    res.status(202).json(enqueueDispatch({ triggerType: 'webhook', scriptIds: req.body.scriptIds || [], machineIds: req.body.machineIds || [] }, null, { idempotencyKey: req.get('Idempotency-Key') }))
  })

  function workerToken(req) {
    const authorization = req.headers.authorization || ''
    return req.headers['x-poshinit-worker-token'] || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
  }

  router.post('/workers/enroll', (req, res, next) => {
    try { res.status(201).json(registerWorker(req.body, req.headers['x-poshinit-worker-enrollment'])) } catch (error) { next(error) }
  })
  router.post('/workers/:id/heartbeat', (req, res, next) => {
    try { res.json(heartbeat(req.params.id, workerToken(req), req.body)) } catch (error) { next(error) }
  })
  router.post('/workers/:id/poll', (req, res, next) => {
    try { res.json(pollWorker(req.params.id, workerToken(req))) } catch (error) { next(error) }
  })
  router.post('/workers/:id/targets/:targetId/complete', (req, res, next) => {
    try { res.json(completeWorkerTarget(req.params.id, workerToken(req), req.params.targetId, req.body)) } catch (error) { next(error) }
  })

  function webhookToken(req) {
    const authorization = req.headers.authorization || ''
    return req.headers['x-poshinit-webhook-token'] || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
  }

  function verifiedScheduleWebhook(req, res) {
    const schedule = getWebhookSchedule(req.params.scheduleId, req.params.webhookKey)
    if (!schedule || webhookToken(req) !== schedule.webhook_token) {
      res.status(401).json({ error: 'Invalid webhook credentials' })
      return null
    }
    return schedule
  }

  router.get('/webhooks/schedules/:scheduleId/:webhookKey', (req, res) => {
    const schedule = verifiedScheduleWebhook(req, res)
    if (schedule) res.json(getScheduleWebhookStatus(schedule.id))
  })

  router.post('/webhooks/schedules/:scheduleId/:webhookKey', async (req, res) => {
    const schedule = verifiedScheduleWebhook(req, res)
    if (!schedule) return
    const dispatch = enqueueDispatch({ scriptIds: all('SELECT script_id FROM schedule_scripts WHERE schedule_id = ?', [schedule.id]).map((row) => row.script_id), machineIds: buildTargetMachines(schedule.id), triggerType: 'schedule-webhook' }, schedule.created_by, { scheduleId: schedule.id, triggerType: 'schedule-webhook', idempotencyKey: req.get('Idempotency-Key') })
    return res.status(202).json({ schedule: getScheduleWebhookStatus(schedule.id), dispatch })
  })

  router.use('/api', requireAuth)

  router.post('/api/auth/logout', (req, res) => {
    recordLogout(req.user, { ip: req.ip })
    res.status(204).end()
  })

  router.get('/api/bootstrap', (req, res) => {
    res.json({
      currentUser: req.user,
      catalog: getCatalog(req.user),
      dashboard: getDashboardSummary(),
      library: listLibrary(),
    })
  })

  router.get('/api/dashboard', (_req, res) => {
    res.json(getDashboardSummary())
  })
  router.get('/api/recommendations', requirePermission('dashboard:read'), (_req, res) => res.json(listRecommendations()))
  router.post('/api/recommendations/:id/ai-preview', requirePermission('dashboard:read'), (req, res) => res.json(aiAssistPreview(req.params.id, req.user.id)))
  router.post('/api/recommendations/:id/confirm', requirePermission('dashboard:read'), (req, res) => res.json(confirmRecommendation(req.params.id, req.user.id, req.body.note)))

  router.get('/api/library', (_req, res) => {
    res.json(listLibrary())
  })

  router.get('/api/workflows', requirePermission('library:read'), (_req, res) => res.json(listWorkflowTemplates()))
  router.post('/api/workflows/validate', requirePermission('library:manage'), (req, res) => res.json(validateWorkflowGraph(req.body.graph)))
  router.post('/api/workflows', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook'), (req, res) => res.json(saveWorkflowTemplate(req.body, req.user.id)))
  router.delete('/api/workflows/:id', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook'), (req, res) => { deleteWorkflowTemplate(req.params.id, req.user.id); res.status(204).end() })
  router.get('/api/workflows/:id/runs', requirePermission('reports:read'), (req, res) => res.json(listWorkflowRuns(req.params.id)))
  router.get('/api/workflow-runs/:id', requirePermission('reports:read'), (req, res) => { const workflow = getWorkflowRun(req.params.id); if (!workflow) return res.status(404).json({ error: 'Workflow run was not found' }); return res.json(workflow) })
  router.post('/api/workflows/:id/runs', requirePermission('runs:execute'), requireResourcePermission('use', 'runbook'), (req, res) => res.status(202).json(startWorkflowRun(req.params.id, req.body.inputs || {}, req.user.id)))

  router.post('/api/library', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook'), (req, res) => {
    res.json(saveLibraryEntry(req.body, req.user.id))
  })

  router.delete('/api/library/:id', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook'), (req, res) => {
    deleteLibraryEntry(req.params.id)
    res.status(204).end()
  })

  router.get('/api/library/:id/versions', (req, res) => {
    res.json(listScriptVersions(req.params.id))
  })

  router.get('/api/library/:id/releases', requirePermission('library:read'), (req, res) => {
    res.json(listRunbookReleases(req.params.id))
  })

  router.post('/api/library/:id/releases', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook'), (req, res) => {
    res.json(createRunbookRelease(req.params.id, req.body, req.user.id))
  })

  router.post('/api/library/releases/:id/reviews', requirePermission('approvals:decide'), requireResourcePermission('approve', 'runbook', (req) => get('SELECT entry_id FROM runbook_releases WHERE id = ?', [req.params.id])?.entry_id || '*'), (req, res) => {
    res.json(reviewRunbookRelease(req.params.id, req.body.decision, req.body.notes, req.user.id))
  })

  router.post('/api/library/releases/:id/transition', requirePermission('library:manage'), requireResourcePermission('admin', 'runbook', (req) => get('SELECT entry_id FROM runbook_releases WHERE id = ?', [req.params.id])?.entry_id || '*'), (req, res) => {
    res.json(transitionRunbookRelease(req.params.id, req.body.state, req.user.id))
  })

  router.get('/api/library/releases/:id/artifact', requirePermission('library:read'), (req, res) => {
    const artifact = getReleaseArtifact(req.params.id)
    if (!artifact) return res.status(404).json({ error: 'Release artifact not found' })
    return res.json(artifact)
  })

  router.get('/api/environments/:id/release-policy', requirePermission('library:read'), (req, res) => {
    res.json(getReleasePolicy(req.params.id))
  })

  router.put('/api/environments/:id/release-policy', requirePermission('settings:manage'), requireResourcePermission('admin', 'runbook', () => '*'), (req, res) => {
    res.json(saveReleasePolicy(req.params.id, req.body))
  })

  router.get('/api/library/:id/preview', (req, res) => {
    const preview = getLibraryPreview(req.params.id)
    if (!preview) return res.status(404).json({ error: 'Library entry not found' })
    return res.json(preview)
  })

  router.get('/api/library/:id/file', (req, res) => {
    const asset = getLibraryAsset(req.params.id)
    if (!asset?.fullPath) return res.status(404).json({ error: 'Library file not found' })
    return res.sendFile(asset.fullPath)
  })

  router.get('/api/library/:id/download', (req, res) => {
    const asset = getLibraryAsset(req.params.id)
    if (!asset) return res.status(404).json({ error: 'Library entry not found' })
    if (asset.fullPath) return res.download(asset.fullPath, asset.entry.name)
    return res.attachment(asset.entry.name).type('text/plain').send(asset.entry.content || '')
  })

  router.post('/api/library/assets', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook'), upload.single('file'), (req, res) => {
    res.json(uploadAsset(req.file))
  })

  router.post('/api/library/import', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook'), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'A file is required' })
    return res.json(importLibraryFile(req.file, req.body, req.user.id))
  })

  router.post('/api/scripts/validate', requirePermission('library:manage'), async (req, res) => {
    res.json(await validatePowerShell(req.body.content || ''))
  })
  router.get('/api/parameter-sets', requirePermission('library:read'), (req, res) => {
    res.json(listParameterSets(req.query.scriptId || null))
  })
  router.post('/api/parameter-sets', requirePermission('library:manage'), requireResourcePermission('edit', 'runbook', (req) => req.body.scriptId || '*'), (req, res) => {
    res.json(saveParameterSet(req.body, req.user.id))
  })

  router.get('/api/machines', (_req, res) => {
    res.json(listMachines())
  })

  router.post('/api/machines', requirePermission('inventory:manage'), requireResourcePermission('edit', 'inventory'), (req, res) => {
    res.json(saveMachine(req.body))
  })

  router.post('/api/machines/:id/test', requirePermission('inventory:manage'), requireResourcePermission('use', 'inventory'), async (req, res) => {
    res.json(await testMachineConnection(req.params.id))
  })
  router.post('/api/machines/test-candidate', requirePermission('inventory:manage'), async (req, res) => {
    res.json(await testMachineCandidate(req.body))
  })
  router.post('/api/subnet-scans', requirePermission('inventory:manage'), (req, res) => {
    res.json(startSubnetScan(req.body))
  })
  router.get('/api/subnet-scans/:id', (req, res) => {
    res.json(getSubnetScan(req.params.id))
  })
  router.post('/api/subnet-scans/:id/import', requirePermission('inventory:manage'), (req, res) => {
    res.json(importSubnetScan(req.params.id, req.body.machines))
  })
  router.post('/api/machines/:id/terminal/connect', requirePermission('runs:execute'), requireResourcePermission('use', 'inventory'), async (req, res) => {
    res.json(await connectTerminal(req.params.id, req.user.id))
  })
  router.post('/api/terminal/:sessionId/command', requirePermission('runs:execute'), async (req, res) => {
    res.json(await runTerminalCommand(req.params.sessionId, req.body.command))
  })
  router.post('/api/terminal/:sessionId/command/stream', requirePermission('runs:execute'), (req, res) => {
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.flushHeaders()
    const emit = (event) => { res.write(`data: ${JSON.stringify(event)}\n\n`); if (event.type === 'complete') res.end() }
    try { streamTerminalCommand(req.params.sessionId, req.body.command, emit) } catch (error) { emit({ type: 'stderr', data: error.message }); emit({ type: 'complete', code: 1 }) }
  })
  router.post('/api/terminal/:sessionId/cancel', requirePermission('runs:execute'), (req, res) => { res.json({ cancelled: cancelTerminalCommand(req.params.sessionId) }) })
  router.post('/api/terminal/:sessionId/disconnect', requirePermission('runs:execute'), (req, res) => {
    disconnectTerminal(req.params.sessionId)
    res.status(204).end()
  })
  router.get('/api/terminal/:sessionId/transcript', requirePermission('runs:execute'), (req, res) => res.json(listTerminalTranscript(req.params.sessionId)))
  router.post('/api/terminal/:sessionId/clipboard', requirePermission('runs:execute'), (req, res) => res.json(auditTerminalClipboard(req.params.sessionId, req.body.direction, req.body.length)))
  router.post('/api/terminal/:sessionId/transfer/:direction', requirePermission('runs:execute'), (req, res) => res.json(terminalTransferGuard(req.params.sessionId, req.params.direction)))
  router.post('/api/machines/:id/broker/:kind', requirePermission('runs:execute'), requireResourcePermission('use', 'inventory'), (req, res) => res.json(brokeredSessionLaunch(req.params.id, req.params.kind, req.user.id)))

  router.post('/api/credentials', requirePermission('vault:manage'), requireResourcePermission('edit', 'credential'), (req, res) => {
    res.json(
      saveCredential(
        {
          ...req.body,
          secretEncrypted: encryptSecret(req.body.secret || ''),
        },
        req.user.id,
      ),
    )
  })

  router.get('/api/groups', (_req, res) => {
    res.json(listGroups())
  })

  router.get('/api/cmdb-sources', requirePermission('inventory:manage'), (req, res) => { assertResourcePermission(req.user, 'edit', 'inventory'); res.json(listCmdbEnrichmentSources()) })
  router.post('/api/cmdb-sources', requirePermission('inventory:manage'), (req, res) => { assertResourcePermission(req.user, 'edit', 'inventory'); res.json(saveCmdbEnrichmentSource(req.body)) })
  router.delete('/api/cmdb-sources/:id', requirePermission('inventory:manage'), (req, res) => { assertResourcePermission(req.user, 'edit', 'inventory'); res.json({ deleted: deleteCmdbEnrichmentSource(req.params.id) }) })
  router.get('/api/cmdb-sources/:id/runs', requirePermission('inventory:read'), (req, res) => { res.json(listCmdbEnrichmentRuns(req.params.id)) })
  router.post('/api/cmdb-sources/:id/sync', async (req, res, next) => { try { assertResourcePermission(req.user, 'edit', 'inventory'); res.json(await syncCmdbEnrichmentSource(req.params.id)) } catch (error) { next(error) } })

  router.post('/api/groups/preview', requirePermission('inventory:manage'), requireResourcePermission('edit', 'inventory'), (req, res) => {
    res.json(previewDynamicGroup(req.body.rule))
  })
  router.get('/api/groups/:id/history', requirePermission('inventory:read'), (req, res) => {
    res.json(listGroupMembershipChanges(req.params.id))
  })
  router.get('/api/groups/:id/machines/:machineId/explanation', requirePermission('inventory:read'), (req, res, next) => {
    try { res.json(explainDynamicGroup(req.params.id, req.params.machineId)) } catch (error) { next(error) }
  })

  router.post('/api/groups', requirePermission('inventory:manage'), requireResourcePermission('edit', 'inventory'), (req, res) => {
    res.json(saveGroup(req.body))
  })

  router.get('/api/schedules', (_req, res) => {
    res.json(listSchedules())
  })

  router.post('/api/schedules', requirePermission('schedules:manage'), requireResourcePermission('edit', 'execution'), (req, res) => {
    res.json(saveSchedule(req.body, req.user.id))
  })
  router.get('/api/approvals', requirePermission('approvals:read'), (_req, res) => res.json(listApprovals()))
  router.post('/api/approvals/:id/decision', requirePermission('approvals:decide'), requireResourcePermission('approve', 'execution'), async (req, res) => { const approval = decideApproval(req.params.id, req.body.status, req.user.id, req.body.notes); const executions = approval.status === 'approved' && approval.entity_type === 'schedule' ? await executeApprovedSchedule(approval.entity_id, req.user.id) : []; return res.json({ approval, executions }) })
  router.get('/api/approval-policies', requirePermission('approvals:read'), (req, res) => res.json(listApprovalPolicies()))
  router.post('/api/approval-policies', requirePermission('settings:manage'), requireResourcePermission('admin', 'execution'), (req, res) => res.json(saveApprovalPolicy(req.body, req.user.id)))

  router.get('/api/schedules/:id/webhook', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required' })
    const webhook = getScheduleWebhook(req.params.id)
    if (!webhook?.webhook_enabled) return res.status(404).json({ error: 'Webhook is not enabled for this schedule' })
    return res.json({ url: `${config.publicAppUrl}/webhooks/schedules/${webhook.id}/${webhook.webhook_key}`, token: webhook.webhook_token })
  })

  router.post('/api/executions/run', requirePermission('runs:execute'), (req, res) => {
    assertDispatchPermissions(req.user, req.body)
    const dispatch = enqueueDispatch(req.body, req.user.id, { idempotencyKey: req.get('Idempotency-Key') })
    res.status(dispatch.reused ? 200 : 202).json(dispatch)
  })
  router.post('/api/executions/run/stream', requirePermission('runs:execute'), (req, res) => {
    assertDispatchPermissions(req.user, req.body)
    const dispatch = enqueueDispatch(req.body, req.user.id, { idempotencyKey: req.get('Idempotency-Key') })
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.flushHeaders()
    const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`)
    let unsubscribe = () => {}
    let completed = false
    const forward = (event) => {
      emit({ type: event.type, targetId: event.targetId, sequence: event.sequence, ...event.data })
      if (event.type === 'dispatch-complete') { completed = true; unsubscribe(); res.end() }
    }
    listDispatchEvents(dispatch.id).forEach(forward)
    if (completed) return
    unsubscribe = subscribeDispatch(dispatch.id, forward)
    req.on('close', unsubscribe)
  })
  router.post('/api/executions/dispatch/:dispatchId/cancel', requirePermission('runs:execute'), (req, res) => {
    res.json({ cancelled: requestDispatchCancellation(req.params.dispatchId) })
  })
  router.get('/api/executions/dispatch/:dispatchId', requirePermission('runs:execute'), (req, res) => {
    const dispatch = getDispatch(req.params.dispatchId)
    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' })
    return res.json(dispatch)
  })
  router.get('/api/executions/dispatch/:dispatchId/events', requirePermission('runs:execute'), (req, res) => {
    res.json(listDispatchEvents(req.params.dispatchId, req.query.after))
  })
  router.get('/api/executions/dispatch/:dispatchId/output/tail', requirePermission('runs:execute'), (req, res) => {
    if (!getDispatch(req.params.dispatchId)) return res.status(404).json({ error: 'Dispatch not found' })
    return res.json(tailDispatchOutput(req.params.dispatchId, req.query.limit, req.query.after))
  })
  router.get('/api/executions/dispatch/:dispatchId/output/download', requirePermission('runs:execute'), (req, res) => {
    if (!getDispatch(req.params.dispatchId)) return res.status(404).json({ error: 'Dispatch not found' })
    recordAudit({ actorId: req.user.id, action: 'output.export', resourceType: 'dispatch', resourceId: req.params.dispatchId, context: { format: 'text', target: 'download' } })
    res.attachment(`poshinit-dispatch-${req.params.dispatchId}.log`).type('text/plain').send(downloadDispatchOutput(req.params.dispatchId))
  })

  router.get('/api/users', requirePermission('identity:manage'), (_req, res) => {
    res.json(listUsers())
  })

  router.post('/api/users', requirePermission('identity:manage'), (req, res) => {
    res.json(saveUser(req.body))
  })

  router.get('/api/access-grants', requirePermission('identity:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage scoped grants' })
    return res.json({ grants: listAccessGrants(), hierarchy: listScopeHierarchy() })
  })
  router.get('/api/projects', requirePermission('identity:manage'), (req, res) => { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage projects' }); res.json(projectHierarchy()) })
  router.post('/api/projects', requirePermission('identity:manage'), (req, res) => { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage projects' }); res.json(saveProject(req.body)) })
  router.post('/api/projects/environments', requirePermission('identity:manage'), (req, res) => { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage environments' }); res.json(saveEnvironment(req.body)) })
  router.delete('/api/projects/:id', requirePermission('identity:manage'), (req, res, next) => { try { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage projects' }); res.json({ deleted: deleteProject(req.params.id) }) } catch (error) { next(error) } })
  router.post('/api/access-grants', requirePermission('identity:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage scoped grants' })
    return res.json(saveAccessGrant(req.body, req.user.id))
  })
  router.delete('/api/access-grants/:id', requirePermission('identity:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage scoped grants' })
    return res.json({ deleted: deleteAccessGrant(req.params.id) })
  })

  router.get('/api/teams', requirePermission('identity:manage'), (_req, res) => {
    res.json(listTeams())
  })

  router.post('/api/teams', requirePermission('identity:manage'), (req, res) => {
    res.json(saveTeam(req.body))
  })

  router.get('/api/settings', requirePermission('settings:manage'), (_req, res) => {
    res.json(getCatalog({ role: 'admin' }).settings)
  })

  router.get('/api/workers', requirePermission('settings:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required' })
    return res.json({ workers: listWorkers(), pools: listWorkerPools() })
  })
  router.post('/api/worker-pools', requirePermission('settings:manage'), (req, res, next) => {
    try { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required' }); return res.json(saveWorkerPool(req.body, req.user.id)) } catch (error) { return next(error) }
  })
  router.post('/api/workers/:id/drain', requirePermission('settings:manage'), (req, res, next) => {
    try { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required' }); return res.json(setWorkerDrain(req.params.id, Boolean(req.body.draining), req.user.id)) } catch (error) { return next(error) }
  })

  router.get('/api/inventory-sources', requirePermission('settings:manage'), (req, res) => {
    assertResourcePermission(req.user, 'admin', 'integration', '*')
    res.json(listInventorySources())
  })
  router.get('/api/inventory-sources/:id/history', requirePermission('settings:manage'), (req, res) => {
    assertResourcePermission(req.user, 'admin', 'integration', '*')
    res.json(listInventorySourceHistory(req.params.id))
  })
  router.get('/api/inventory-sources/:id/errors', requirePermission('settings:manage'), (req, res) => {
    assertResourcePermission(req.user, 'admin', 'integration', '*')
    res.json(listInventorySourceErrors(req.params.id))
  })
  router.post('/api/inventory-sources/:id', requirePermission('settings:manage'), (req, res) => {
    assertResourcePermission(req.user, 'admin', 'integration', '*')
    res.json(updateInventorySource(req.params.id, req.body))
  })
  router.post('/api/inventory-sources/:id/sync', async (req, res, next) => {
    try { assertResourcePermission(req.user, 'admin', 'integration', '*'); res.json(await syncInventorySource(req.params.id)) } catch (error) { next(error) }
  })

  router.get('/api/settings/remote-sessions', requirePermission('settings:manage'), (req, res) => res.json(getRemoteSessionSettings()))
  router.post('/api/settings/remote-sessions', requirePermission('settings:manage'), (req, res) => res.json(saveRemoteSessionSettings(req.body)))

  router.post('/api/settings/:key', (req, res) => {
    if (req.params.key === 'runtime') {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can configure execution reliability controls' })
      return res.json(saveSettings('runtime', req.body))
    }
    if (req.params.key === 'audit') {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can configure audit delivery' })
      return res.json(saveAuditSettings(req.body))
    }
    if (req.params.key === 'entra') {
      if (req.user.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can configure Microsoft Entra ID' })
        return
      }
      res.json(saveEntraSettings(req.body))
      return
    }

    if (req.params.key === 'notifications') {
      if (req.user.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can configure alert delivery' })
        return
      }
      res.json(saveNotificationSettings(req.body))
      return
    }

    if (req.params.key === 'secretProviders') {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can configure external secret providers' })
      assertResourcePermission(req.user, 'admin', 'integration', 'secret-providers')
      return res.json(saveSecretProviderSettings(req.body))
    }

    if (req.params.key === 'vcenter') {
      assertResourcePermission(req.user, 'admin', 'integration', 'vmware')
      const saved = saveVcenterSettings(req.body)
      ensureManagedInventorySources()
      res.json(saved)
      return
    }

    if (req.params.key === 'azureArc') {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can configure Azure Arc' })
      assertResourcePermission(req.user, 'admin', 'integration', 'azure-arc')
      const saved = saveAzureArcSettings(req.body)
      ensureManagedInventorySources()
      return res.json(saved)
    }
    if (req.params.key === 'proxmox') { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can configure Proxmox' }); assertResourcePermission(req.user, 'admin', 'integration', 'proxmox'); const saved = saveProxmoxSettings(req.body); ensureManagedInventorySources(); return res.json(saved) }

    res.json(saveSettings(req.params.key, req.body))
  })

  router.get('/api/reliability/status', requirePermission('settings:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can view execution reliability controls' })
    return res.json(getReliabilityStatus())
  })
  router.get('/api/reliability/dead-letters', requirePermission('settings:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can view dead-letter targets' })
    return res.json(listDeadLetters())
  })
  router.post('/api/reliability/dead-letters/:id/requeue', requirePermission('settings:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can requeue dead-letter targets' })
    return res.json({ requeued: requeueDeadLetter(req.params.id) })
  })

  router.get('/api/notification-policies', (_req, res) => { res.json(listNotificationPolicies()) })
  router.post('/api/notification-policies', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage notification policies' })
    return res.json(saveNotificationPolicy(req.body))
  })
  router.post('/api/notification-policies/:id/enabled', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage notification policies' })
    return res.json(setNotificationPolicyEnabled(req.params.id, Boolean(req.body.enabled)))
  })
  router.post('/api/notification-policies/:id/test', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage notification policies' })
    await testNotificationPolicy(req.params.id)
    return res.status(204).end()
  })
  router.delete('/api/notification-policies/:id', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can manage notification policies' })
    deleteNotificationPolicy(req.params.id)
    return res.status(204).end()
  })

  router.post('/api/vcenter/import', async (req, res) => {
    res.json(await importVcenterMachines(req.body))
  })

  router.post('/api/vmware/import', async (req, res) => {
    const settings = getSettings().vcenter
    const connector = (settings.connectors || []).find((item) => item.id === req.body.connectorId)
    res.json(
      await importVmwareMachines(
        { connectors: [{ ...connector, passwordPlain: req.body.passwordPlain }] },
        req.body.connectorId,
      ),
    )
  })

  router.post('/api/vmware/discover', async (req, res) => {
    res.json(await discoverVmwareMachines(getSettings().vcenter, req.body.connectorId))
  })

  router.post('/api/vmware/import-selection', async (req, res) => {
    res.json(
      await importVmwareSelection(
        getSettings().vcenter,
        req.body.connectorId,
        req.body.vmIds,
        req.body.credentialIds,
      ),
    )
  })

  router.post('/api/azure-arc/discover', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can discover Azure Arc machines' })
    return res.json(await discoverAzureArcMachines(getSettings().azureArc, req.body.connectorId))
  })

  router.post('/api/azure-arc/import-selection', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can import Azure Arc machines' })
    return res.json(await importAzureArcSelection(getSettings().azureArc, req.body.connectorId, req.body.machineIds, req.body.credentialIds))
  })
  router.post('/api/proxmox/discover', async (req, res) => { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can discover Proxmox machines' }); return res.json(await discoverProxmoxMachines(getSettings().proxmox, req.body.connectorId)) })
  router.post('/api/proxmox/import-selection', async (req, res) => { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can import Proxmox machines' }); return res.json(await importProxmoxSelection(getSettings().proxmox, req.body.connectorId, req.body.machineIds, req.body.credentialIds)) })

  router.get('/api/logs', (req, res) => {
    res.json(searchLogs(req.query.q || ''))
  })
  router.get('/api/reports/dashboard', requirePermission('reports:read'), (req, res) => res.json(reportingDashboard(req.query.periodDays, req.query)))
  router.get('/api/reports/schedules', requirePermission('reports:read'), (_req, res) => res.json(listReportSchedules()))
  router.post('/api/reports/schedules', requirePermission('settings:manage'), (req, res, next) => { try { res.json(saveReportSchedule(req.body, req.user.id)) } catch (error) { next(error) } })
  router.get('/api/reports/artifacts', requirePermission('reports:read'), (req, res) => res.json(listReportArtifacts(req.query.limit)))
  router.post('/api/reports/generate', requirePermission('reports:read'), (req, res, next) => { try { res.status(201).json(generateReport(req.body, req.user.id)) } catch (error) { next(error) } })
  router.get('/api/reports/artifacts/:id', requirePermission('reports:read'), (req, res) => { const artifact = getReportArtifact(req.params.id); if (!artifact) return res.status(404).json({ error: 'Report artifact was not found' }); return res.json(artifact) })
  router.get('/api/reports/artifacts/:id/evidence', requirePermission('reports:read'), (req, res) => { const bundle = evidenceBundle(req.params.id); if (!bundle) return res.status(404).json({ error: 'Report artifact was not found' }); recordAudit({ actorId: req.user.id, action: 'report.evidence.export', resourceType: 'report-artifact', resourceId: req.params.id }); return res.json(bundle) })
  router.get('/api/reports/artifacts/:id/export/:format', requirePermission('reports:read'), (req, res) => { const exported = exportReportArtifact(req.params.id, req.params.format); if (!exported) return res.status(404).json({ error: 'Report artifact was not found' }); recordAudit({ actorId: req.user.id, action: 'report.export', resourceType: 'report-artifact', resourceId: req.params.id, context: { format: req.params.format } }); res.attachment(`poshinit-report-${req.params.id}.${exported.extension}`).type(exported.contentType).send(exported.body) })
  router.post('/api/reports/artifacts/:id/legal-hold', requirePermission('settings:manage'), (req, res, next) => { try { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required' }); return res.json(setReportLegalHold(req.params.id, Boolean(req.body.legalHold), req.user.id)) } catch (error) { return next(error) } })
  router.get('/api/audit-events', requirePermission('settings:manage'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can view audit evidence' })
    return res.json({ events: listAuditEvents(req.query.q || ''), integrity: verifyAuditChain() })
  })

  return router
}
