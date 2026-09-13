import crypto from 'node:crypto'
import { nanoid } from 'nanoid'
import { all, get, nowIso, run, transaction } from '../db/client.js'
import { config } from '../config.js'
import { redactOutput } from './outputRedactionService.js'
import { recordAudit } from './auditService.js'
import { refreshDispatchStatus } from './jobQueueService.js'

const ONLINE_WINDOW_MS = 60_000
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')
function parse(value, fallback = {}) { try { return JSON.parse(value || '') } catch (_error) { return fallback } }
function normalizedLabels(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function labelsMatch(actual, required) { return Object.entries(normalizedLabels(required)).every(([key, value]) => String(actual?.[key]) === String(value)) }
function workerPublic(row) {
  if (!row) return null
  const lastHeartbeat = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0
  return { ...row, capabilities: parse(row.capabilities_json, []), labels: parse(row.labels_json, {}), draining: row.status === 'draining', online: Boolean(lastHeartbeat && Date.now() - lastHeartbeat < ONLINE_WINDOW_MS) }
}
function poolPublic(row) { return { ...row, labels: parse(row.labels_json), placement: parse(row.placement_json), draining: Boolean(row.draining) } }
function authenticatedWorker(id, token) {
  const row = get('SELECT * FROM execution_workers WHERE id = ? AND token_hash = ?', [id, hash(token)])
  if (!row) { const error = new Error('Worker authentication failed'); error.statusCode = 401; throw error }
  return row
}
function appendWorkerEvent(dispatchId, targetId, type, data) {
  const sequence = (get('SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM job_events WHERE dispatch_id = ?', [dispatchId])?.value || 1)
  const timestamp = nowIso()
  run('INSERT INTO job_events (id, dispatch_id, target_id, sequence, event_type, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [nanoid(), dispatchId, targetId, sequence, type, JSON.stringify(data), timestamp])
  if (type === 'stdout' || type === 'stderr') run('INSERT INTO job_output_chunks (id, dispatch_id, target_id, sequence, stream, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [nanoid(), dispatchId, targetId, sequence, type, data.data, timestamp])
}

export function listWorkers() { return all('SELECT w.*, p.name AS pool_name, p.draining AS pool_draining FROM execution_workers w LEFT JOIN worker_pools p ON p.id = w.pool_id ORDER BY w.name').map(workerPublic) }
export function listWorkerPools() { return all('SELECT * FROM worker_pools ORDER BY name').map(poolPublic) }

export function saveWorkerPool(payload = {}, actorId) {
  const name = String(payload.name || '').trim()
  if (!name) { const error = new Error('A worker pool name is required'); error.statusCode = 400; throw error }
  const id = payload.id || nanoid()
  const timestamp = nowIso()
  run(`INSERT INTO worker_pools (id, name, labels_json, placement_json, draining, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, labels_json = excluded.labels_json, placement_json = excluded.placement_json, draining = excluded.draining, updated_at = excluded.updated_at`,
  [id, name, JSON.stringify(normalizedLabels(payload.labels)), JSON.stringify({ requiredLabels: normalizedLabels(payload.placement?.requiredLabels) }), payload.draining ? 1 : 0, timestamp, timestamp])
  recordAudit({ actorId, action: 'worker-pool.saved', resourceType: 'worker-pool', resourceId: id, context: { name, draining: Boolean(payload.draining) } })
  return poolPublic(get('SELECT * FROM worker_pools WHERE id = ?', [id]))
}

export function setWorkerDrain(id, draining, actorId) {
  const result = run('UPDATE execution_workers SET status = ?, updated_at = ? WHERE id = ?', [draining ? 'draining' : 'active', nowIso(), id])
  if (!result.changes) { const error = new Error('Worker was not found'); error.statusCode = 404; throw error }
  recordAudit({ actorId, action: draining ? 'worker.drained' : 'worker.activated', resourceType: 'worker', resourceId: id })
  return workerPublic(get('SELECT * FROM execution_workers WHERE id = ?', [id]))
}

export function registerWorker(payload = {}, enrollmentToken) {
  if (!enrollmentToken || !crypto.timingSafeEqual(Buffer.from(hash(enrollmentToken)), Buffer.from(hash(config.workerEnrollmentToken)))) {
    const error = new Error('Invalid worker enrollment token'); error.statusCode = 401; throw error
  }
  const id = String(payload.id || nanoid())
  const poolId = payload.poolId || null
  if (poolId && !get('SELECT id FROM worker_pools WHERE id = ?', [poolId])) { const error = new Error('Worker pool was not found'); error.statusCode = 400; throw error }
  const token = crypto.randomBytes(32).toString('base64url')
  const timestamp = nowIso()
  run(`INSERT INTO execution_workers (id, name, pool_id, version, capabilities_json, labels_json, token_hash, status, last_heartbeat_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, pool_id = excluded.pool_id, version = excluded.version, capabilities_json = excluded.capabilities_json, labels_json = excluded.labels_json, token_hash = excluded.token_hash, status = 'active', last_heartbeat_at = excluded.last_heartbeat_at, updated_at = excluded.updated_at`,
  [id, String(payload.name || 'POSHinit worker'), poolId, String(payload.version || 'unknown'), JSON.stringify(Array.isArray(payload.capabilities) ? payload.capabilities : []), JSON.stringify(normalizedLabels(payload.labels)), hash(token), timestamp, timestamp, timestamp])
  recordAudit({ actorType: 'worker', action: 'worker.registered', resourceType: 'worker', resourceId: id, context: { poolId, version: payload.version || 'unknown' } })
  return { protocolVersion: 'v1', heartbeatSeconds: 15, worker: workerPublic(get('SELECT * FROM execution_workers WHERE id = ?', [id])), token }
}

export function heartbeat(id, token, payload = {}) {
  const current = authenticatedWorker(id, token)
  const status = payload.draining ? 'draining' : current.status === 'draining' ? 'draining' : 'active'
  const timestamp = nowIso()
  run('UPDATE execution_workers SET status = ?, version = ?, capabilities_json = ?, labels_json = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?', [status, String(payload.version || current.version), JSON.stringify(Array.isArray(payload.capabilities) ? payload.capabilities : parse(current.capabilities_json, [])), JSON.stringify(payload.labels ? normalizedLabels(payload.labels) : parse(current.labels_json)), timestamp, timestamp, id])
  const pool = current.pool_id && get('SELECT * FROM worker_pools WHERE id = ?', [current.pool_id])
  return { protocolVersion: 'v1', worker: workerPublic(get('SELECT * FROM execution_workers WHERE id = ?', [id])), pool: pool ? poolPublic(pool) : null }
}

export function pollWorker(id, token) {
  const current = authenticatedWorker(id, token)
  const pool = current.pool_id && get('SELECT * FROM worker_pools WHERE id = ?', [current.pool_id])
  if (current.status !== 'active' || pool?.draining) return { protocolVersion: 'v1', target: null, reason: 'worker-draining' }
  const candidates = all(`SELECT jt.*, jd.payload_json, s.content, s.name AS script_name, m.name AS machine_name, m.fqdn, m.ip_address, m.transport, m.port
    FROM job_targets jt JOIN job_dispatches jd ON jd.id = jt.dispatch_id JOIN library_entries s ON s.id = jt.script_id JOIN machines m ON m.id = jt.machine_id
    WHERE jt.status = 'queued' AND jt.available_at <= ? AND jd.cancel_requested = 0 AND (jd.deadline_at IS NULL OR jd.deadline_at > ?)
    ORDER BY jt.available_at ASC, jt.created_at ASC LIMIT 50`, [nowIso(), nowIso()])
  const candidate = candidates.find((row) => {
    const payload = parse(row.payload_json)
    return (!payload.workerPoolId || payload.workerPoolId === current.pool_id) && labelsMatch(parse(current.labels_json), pool ? parse(pool.placement_json).requiredLabels : {})
  })
  if (!candidate) return { protocolVersion: 'v1', target: null }
  const timestamp = nowIso()
  const claimed = run("UPDATE job_targets SET status = 'running', attempt = attempt + 1, started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'", [timestamp, timestamp, candidate.id])
  if (!claimed.changes) return { protocolVersion: 'v1', target: null }
  run("UPDATE job_dispatches SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?", [timestamp, timestamp, candidate.dispatch_id])
  appendWorkerEvent(candidate.dispatch_id, candidate.id, 'worker-claimed', { workerId: id, poolId: current.pool_id })
  return { protocolVersion: 'v1', target: { id: candidate.id, dispatchId: candidate.dispatch_id, timeoutSeconds: candidate.timeout_seconds, script: { id: candidate.script_id, name: candidate.script_name, content: candidate.content }, machine: { id: candidate.machine_id, name: candidate.machine_name, fqdn: candidate.fqdn, ipAddress: candidate.ip_address, transport: candidate.transport, port: candidate.port } } }
}

export function completeWorkerTarget(workerId, token, targetId, payload = {}) {
  authenticatedWorker(workerId, token)
  const target = get("SELECT * FROM job_targets WHERE id = ? AND status = 'running'", [targetId])
  if (!target) { const error = new Error('Claimed target was not found'); error.statusCode = 404; throw error }
  const status = ['success', 'failed', 'cancelled'].includes(payload.status) ? payload.status : 'failed'
  const stdout = redactOutput(payload.stdout || '')
  const stderr = redactOutput(payload.stderr || '')
  transaction(() => {
    run('UPDATE job_targets SET status = ?, finished_at = ?, updated_at = ?, last_error = ? WHERE id = ?', [status, nowIso(), nowIso(), stderr || null, targetId])
    if (stdout) appendWorkerEvent(target.dispatch_id, targetId, 'stdout', { data: stdout })
    if (stderr) appendWorkerEvent(target.dispatch_id, targetId, 'stderr', { data: stderr })
    appendWorkerEvent(target.dispatch_id, targetId, 'complete', { workerId, status, exitCode: payload.exitCode ?? null })
  })
  const dispatchStatus = refreshDispatchStatus(target.dispatch_id)
  recordAudit({ actorType: 'worker', action: 'worker.target.completed', resourceType: 'target', resourceId: targetId, outcome: status, context: { workerId, dispatchId: target.dispatch_id } })
  return { accepted: true, status, dispatchStatus }
}
