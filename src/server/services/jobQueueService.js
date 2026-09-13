import { nanoid } from 'nanoid'
import { all, get, nowIso, run, transaction } from '../db/client.js'
import { buildTargetMachines, runExecution } from './executionService.js'
import { writeLog } from './logService.js'
import { redactOutput } from './outputRedactionService.js'
import { getSettings } from './settingsService.js'
import { logger } from '../utils/logger.js'
import { recordAudit } from './auditService.js'

const listeners = new Map()
const activeTargets = new Map()
let workerRunning = false

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || '') } catch (_error) { return fallback }
}

function mapDispatch(row) {
  if (!row) return null
  return {
    ...row,
    cancelRequested: Boolean(row.cancel_requested),
    retryLimit: row.retry_limit,
    timeoutSeconds: row.timeout_seconds,
    jobTimeoutSeconds: row.job_timeout_seconds || 0,
    deadlineAt: row.deadline_at || null,
    payload: parseJson(row.payload_json),
  }
}

function dispatchTargets(dispatchId) {
  return all('SELECT * FROM job_targets WHERE dispatch_id = ? ORDER BY created_at ASC', [dispatchId])
}

function nextSequence(dispatchId) {
  return (get('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM job_events WHERE dispatch_id = ?', [dispatchId])?.sequence || 0) + 1
}

function appendEvent(dispatchId, targetId, type, data) {
  const event = { id: nanoid(), dispatchId, targetId, sequence: nextSequence(dispatchId), type, data, createdAt: nowIso() }
  run(
    `INSERT INTO job_events (id, dispatch_id, target_id, sequence, event_type, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [event.id, dispatchId, targetId || null, event.sequence, type, JSON.stringify(data), event.createdAt],
  )
  if (type === 'stdout' || type === 'stderr') {
    run(
      `INSERT INTO job_output_chunks (id, dispatch_id, target_id, sequence, stream, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), dispatchId, targetId || null, event.sequence, type, String(data.data || ''), event.createdAt],
    )
  }
  listeners.get(dispatchId)?.forEach((listener) => listener(event))
  return event
}

function terminalDispatchStatus(dispatchId) {
  const rows = dispatchTargets(dispatchId)
  if (!rows.length) return 'completed'
  if (rows.some((row) => row.status === 'running' || row.status === 'queued')) return null
  if (rows.every((row) => row.status === 'success')) return 'completed'
  if (rows.every((row) => row.status === 'cancelled')) return 'cancelled'
  return 'completed_with_errors'
}

function refreshDispatch(dispatchId) {
  if (get('SELECT status FROM job_dispatches WHERE id = ?', [dispatchId])?.status === 'timed_out') return 'timed_out'
  const status = terminalDispatchStatus(dispatchId)
  if (!status) return null
  const timestamp = nowIso()
  run('UPDATE job_dispatches SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?', [status, timestamp, timestamp, dispatchId])
  appendEvent(dispatchId, null, 'dispatch-complete', { status })
  return status
}

function runtimeSettings() {
  return getSettings().runtime
}

function targetTimeout(payload, machineId, defaults) {
  const requested = payload.targetTimeouts?.[machineId] ?? payload.targetTimeoutSeconds ?? payload.timeoutSeconds ?? defaults.defaultTargetTimeoutSeconds
  return Math.max(10, Math.min(86400, Number(requested) || defaults.defaultTargetTimeoutSeconds))
}

function retryDelay(attempt, settings) {
  return Math.min(settings.retryMaxSeconds, settings.retryBaseSeconds * (2 ** Math.max(0, attempt - 1)))
}

function consumeRateLimit(settings) {
  if (!settings.maxDispatchesPerMinute) return
  const scope = 'dispatches:global'
  const timestamp = nowIso()
  const row = get('SELECT * FROM job_rate_limits WHERE scope = ?', [scope])
  const started = row ? new Date(row.window_started_at).getTime() : 0
  const freshWindow = !row || Date.now() - started >= 60000
  const count = freshWindow ? 1 : row.request_count + 1
  if (count > settings.maxDispatchesPerMinute) {
    const error = new Error('Dispatch rate limit exceeded. Try again shortly.')
    error.statusCode = 429
    throw error
  }
  run(
    `INSERT INTO job_rate_limits (scope, window_started_at, request_count, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET window_started_at = excluded.window_started_at, request_count = excluded.request_count, updated_at = excluded.updated_at`,
    [scope, freshWindow ? timestamp : row.window_started_at, count, timestamp],
  )
}

function assertReleasedForProtectedTargets(scriptIds, machineIds) {
  const protectedEnvironmentIds = [...new Set(machineIds.map((machineId) => get(`SELECT m.environment_id
    FROM machines m JOIN environments e ON e.id = m.environment_id
    WHERE m.id = ? AND e.is_protected = 1`, [machineId])?.environment_id).filter(Boolean))]
  if (!protectedEnvironmentIds.length) return
  scriptIds.forEach((scriptId) => protectedEnvironmentIds.forEach((environmentId) => {
    const release = get("SELECT id FROM runbook_releases WHERE entry_id = ? AND environment_id = ? AND state = 'released'", [scriptId, environmentId])
    if (!release) {
      const error = new Error('A signed released runbook is required before execution against protected environment targets')
      error.statusCode = 409
      throw error
    }
  }))
}

export function enqueueDispatch(payload, requestedBy, options = {}) {
  const settings = runtimeSettings()
  if (settings.workerMode === 'maintenance') {
    const error = new Error('The execution worker is in maintenance mode and is not accepting dispatches')
    error.statusCode = 503
    throw error
  }
  const scriptIds = [...new Set(payload.scriptIds || [])]
  const machineIds = [...new Set(payload.machineIds || [])]
  if (!scriptIds.length || !machineIds.length) {
    const error = new Error('Select at least one runbook and one execution target')
    error.statusCode = 400
    throw error
  }
  assertReleasedForProtectedTargets(scriptIds, machineIds)
  const idempotencyKey = String(options.idempotencyKey || payload.idempotencyKey || nanoid())
  const existing = get('SELECT * FROM job_dispatches WHERE idempotency_key = ?', [idempotencyKey])
  if (existing) return { ...mapDispatch(existing), targets: dispatchTargets(existing.id), reused: true }

  const dispatchId = nanoid()
  const timestamp = nowIso()
  const retryLimit = Math.max(0, Math.min(10, Number(payload.retryLimit ?? options.retryLimit ?? 0) || 0))
  const timeoutSeconds = targetTimeout(payload, machineIds[0], settings)
  const jobTimeoutSeconds = Math.max(0, Math.min(604800, Number(payload.jobTimeoutSeconds ?? options.jobTimeoutSeconds ?? settings.defaultJobTimeoutSeconds) || 0))
  const deadlineAt = jobTimeoutSeconds ? new Date(Date.now() + jobTimeoutSeconds * 1000).toISOString() : null
  const triggerType = payload.triggerType || options.triggerType || 'manual'
  const scheduleId = options.scheduleId || payload.scheduleId || null
  transaction(() => {
    consumeRateLimit(settings)
    run(
      `INSERT INTO job_dispatches (id, idempotency_key, trigger_type, schedule_id, requested_by, status, cancel_requested, retry_limit, timeout_seconds, job_timeout_seconds, deadline_at, payload_json, queued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [dispatchId, idempotencyKey, triggerType, scheduleId, requestedBy, retryLimit, timeoutSeconds, jobTimeoutSeconds, deadlineAt, JSON.stringify({ scriptIds, machineIds, workerPoolId: payload.workerPoolId || null }), timestamp, timestamp, timestamp],
    )
    scriptIds.forEach((scriptId) => machineIds.forEach((machineId) => run(
      `INSERT INTO job_targets (id, dispatch_id, script_id, machine_id, status, attempt, max_attempts, timeout_seconds, available_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)`,
      [nanoid(), dispatchId, scriptId, machineId, retryLimit + 1, targetTimeout(payload, machineId, settings), timestamp, timestamp, timestamp],
    )))
  })
  appendEvent(dispatchId, null, 'dispatch', { dispatchId, status: 'queued', targetCount: scriptIds.length * machineIds.length, deadlineAt })
  writeLog('info', 'queue', 'Execution dispatch queued', { dispatchId, triggerType, requestedBy, targetCount: scriptIds.length * machineIds.length })
  recordAudit({ actorId: requestedBy, action: 'execution.dispatch', resourceType: 'dispatch', resourceId: dispatchId, context: { triggerType, scriptIds, targetIds: machineIds, targetCount: scriptIds.length * machineIds.length } })
  return { ...getDispatch(dispatchId), reused: false }
}

export function enqueueScheduleDispatch(scheduleId, triggerType, requestedBy) {
  const scriptIds = all('SELECT script_id FROM schedule_scripts WHERE schedule_id = ?', [scheduleId]).map((row) => row.script_id)
  return enqueueDispatch({ scriptIds, machineIds: buildTargetMachines(scheduleId), triggerType }, requestedBy, { scheduleId, triggerType })
}

export function getDispatch(dispatchId) {
  const dispatch = mapDispatch(get('SELECT * FROM job_dispatches WHERE id = ?', [dispatchId]))
  return dispatch ? { ...dispatch, targets: dispatchTargets(dispatchId) } : null
}

export function listDispatchEvents(dispatchId, afterSequence = 0) {
  return all('SELECT * FROM job_events WHERE dispatch_id = ? AND sequence > ? ORDER BY sequence ASC', [dispatchId, Number(afterSequence) || 0])
    .map((row) => ({ id: row.id, dispatchId: row.dispatch_id, targetId: row.target_id, sequence: row.sequence, type: row.event_type, data: parseJson(row.data_json), createdAt: row.created_at }))
}

export function tailDispatchOutput(dispatchId, limit = 200, afterSequence = 0) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200))
  return all(
    `SELECT * FROM job_output_chunks WHERE dispatch_id = ? AND sequence > ?
     ORDER BY sequence DESC LIMIT ?`,
    [dispatchId, Number(afterSequence) || 0, safeLimit],
  ).reverse().map((row) => ({ targetId: row.target_id, sequence: row.sequence, stream: row.stream, content: row.content, createdAt: row.created_at }))
}

export function downloadDispatchOutput(dispatchId) {
  return all('SELECT stream, content, created_at FROM job_output_chunks WHERE dispatch_id = ? ORDER BY sequence ASC', [dispatchId])
    .map((row) => `[${row.created_at}] ${row.stream.toUpperCase()} ${row.content}`)
    .join('')
}

export function subscribeDispatch(dispatchId, listener) {
  if (!listeners.has(dispatchId)) listeners.set(dispatchId, new Set())
  listeners.get(dispatchId).add(listener)
  return () => {
    const subscribers = listeners.get(dispatchId)
    subscribers?.delete(listener)
    if (!subscribers?.size) listeners.delete(dispatchId)
  }
}

export function requestDispatchCancellation(dispatchId) {
  const dispatch = getDispatch(dispatchId)
  if (!dispatch || ['completed', 'completed_with_errors', 'cancelled', 'timed_out'].includes(dispatch.status)) return false
  const timestamp = nowIso()
  transaction(() => {
    run('UPDATE job_dispatches SET cancel_requested = 1, updated_at = ? WHERE id = ?', [timestamp, dispatchId])
    run("UPDATE job_targets SET status = 'cancelled', finished_at = ?, updated_at = ?, last_error = 'Cancelled before execution' WHERE dispatch_id = ? AND status = 'queued'", [timestamp, timestamp, dispatchId])
  })
  activeTargets.forEach(({ runtime }, targetId) => {
    if (get('SELECT dispatch_id FROM job_targets WHERE id = ?', [targetId])?.dispatch_id === dispatchId) {
      runtime.cancelled = true
      runtime.cancelActive?.()
    }
  })
  appendEvent(dispatchId, null, 'dispatch-cancel-requested', {})
  refreshDispatch(dispatchId)
  return true
}

function claimNextTarget(settings) {
  const timestamp = nowIso()
  const running = get("SELECT COUNT(*) AS count FROM job_targets WHERE status = 'running'")?.count || 0
  if (running >= settings.maxConcurrentTargets) return null
  const candidate = get(
    `SELECT jt.*, jd.trigger_type, jd.schedule_id, jd.requested_by, jd.cancel_requested
     FROM job_targets jt JOIN job_dispatches jd ON jd.id = jt.dispatch_id
     LEFT JOIN machine_circuits mc ON mc.machine_id = jt.machine_id
     WHERE jt.status = 'queued' AND jt.available_at <= ? AND jd.cancel_requested = 0
       AND (json_extract(jd.payload_json, '$.workerPoolId') IS NULL OR json_extract(jd.payload_json, '$.workerPoolId') = '')
       AND (jd.deadline_at IS NULL OR jd.deadline_at > ?)
       AND (mc.open_until IS NULL OR mc.open_until <= ?)
       AND (SELECT COUNT(*) FROM job_targets same_dispatch WHERE same_dispatch.dispatch_id = jt.dispatch_id AND same_dispatch.status = 'running') < ?
       AND (SELECT COUNT(*) FROM job_targets same_machine WHERE same_machine.machine_id = jt.machine_id AND same_machine.status = 'running') < ?
     ORDER BY jt.available_at ASC, jt.created_at ASC LIMIT 1`,
    [timestamp, timestamp, timestamp, settings.maxConcurrentPerDispatch, settings.maxConcurrentPerMachine],
  )
  if (!candidate) return null
  const claimed = run(
    "UPDATE job_targets SET status = 'running', attempt = attempt + 1, started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'",
    [timestamp, timestamp, candidate.id],
  )
  if (claimed.changes !== 1) return null
  run("UPDATE job_dispatches SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?", [timestamp, timestamp, candidate.dispatch_id])
  return { ...candidate, attempt: candidate.attempt + 1 }
}

function recordCircuitOutcome(machineId, failed, errorText, settings) {
  const timestamp = nowIso()
  if (!failed) {
    run(
      `INSERT INTO machine_circuits (machine_id, consecutive_failures, state, opened_at, open_until, last_error, updated_at)
       VALUES (?, 0, 'closed', NULL, NULL, NULL, ?)
       ON CONFLICT(machine_id) DO UPDATE SET consecutive_failures = 0, state = 'closed', opened_at = NULL, open_until = NULL, last_error = NULL, updated_at = excluded.updated_at`,
      [machineId, timestamp],
    )
    return false
  }
  const current = get('SELECT consecutive_failures FROM machine_circuits WHERE machine_id = ?', [machineId])
  const failures = (current?.consecutive_failures || 0) + 1
  const open = failures >= settings.circuitFailureThreshold
  const openUntil = open ? delayUntil(settings.circuitOpenSeconds) : null
  run(
    `INSERT INTO machine_circuits (machine_id, consecutive_failures, state, opened_at, open_until, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(machine_id) DO UPDATE SET consecutive_failures = excluded.consecutive_failures, state = excluded.state, opened_at = excluded.opened_at, open_until = excluded.open_until, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    [machineId, failures, open ? 'open' : 'closed', open ? timestamp : null, openUntil, errorText || 'Target execution failed', timestamp],
  )
  return open
}

function deadLetter(target, reason) {
  const timestamp = nowIso()
  run("UPDATE job_targets SET status = 'dead_letter', finished_at = ?, updated_at = ?, last_error = ? WHERE id = ?", [timestamp, timestamp, reason, target.id])
  run(
    `INSERT INTO job_dead_letters (id, target_id, dispatch_id, machine_id, script_id, attempts, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_id) DO UPDATE SET attempts = excluded.attempts, reason = excluded.reason, created_at = excluded.created_at, resolved_at = NULL`,
    [nanoid(), target.id, target.dispatch_id, target.machine_id, target.script_id, target.attempt, reason, timestamp],
  )
  appendEvent(target.dispatch_id, target.id, 'target-dead-lettered', { targetId: target.id, reason })
}

function delayUntil(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

async function executeTarget(target) {
  const settings = runtimeSettings()
  const runtime = { cancelled: false, timedOut: false, cancelActive: null, redactOutput }
  activeTargets.set(target.id, { dispatchId: target.dispatch_id, runtime })
  appendEvent(target.dispatch_id, target.id, 'target-started', { targetId: target.id, scriptId: target.script_id, machineId: target.machine_id, attempt: target.attempt })
  recordAudit({ actorType: 'worker', action: 'execution.target.start', resourceType: 'target', resourceId: target.id, context: { workerIdentity: `api-worker:${process.pid}`, dispatchId: target.dispatch_id, scriptId: target.script_id, targetIdentity: target.machine_id, attempt: target.attempt } })
  let timeout
  try {
    timeout = setTimeout(() => {
      runtime.cancelled = true
      runtime.timedOut = true
      runtime.cancelActive?.()
    }, target.timeout_seconds * 1000)
    const execution = await runExecution({
      triggerType: target.trigger_type,
      scheduleId: target.schedule_id,
      scriptId: target.script_id,
      machineId: target.machine_id,
      requestedBy: target.requested_by,
      dispatch: runtime,
      onOutput: (event) => {
        if (event.type === 'stdout' || event.type === 'stderr') appendEvent(target.dispatch_id, target.id, event.type, { ...event, targetId: target.id })
      },
    })
    clearTimeout(timeout)
    const failed = !['success', 'cancelled'].includes(execution.status)
    const retry = failed && target.attempt < target.max_attempts && !runtime.cancelled
    const timestamp = nowIso()
    if (retry) {
      const delay = retryDelay(target.attempt, settings)
      run("UPDATE job_targets SET status = 'queued', available_at = ?, updated_at = ?, last_error = ? WHERE id = ?", [delayUntil(delay), timestamp, execution.stderr || 'Execution failed', target.id])
      appendEvent(target.dispatch_id, target.id, 'target-retry', { targetId: target.id, attempt: target.attempt, retryInSeconds: delay })
    } else {
      const status = runtime.timedOut ? 'timed_out' : execution.status
      if (failed && !runtime.cancelled) deadLetter(target, execution.stderr || 'Execution failed after all retry attempts')
      else run('UPDATE job_targets SET status = ?, finished_at = ?, updated_at = ?, execution_id = ?, last_error = ? WHERE id = ?', [status, timestamp, timestamp, execution.id, execution.stderr || null, target.id])
      const circuitOpened = recordCircuitOutcome(target.machine_id, failed && !runtime.cancelled, execution.stderr, settings)
      if (circuitOpened) appendEvent(target.dispatch_id, target.id, 'circuit-opened', { machineId: target.machine_id, retryAfterSeconds: settings.circuitOpenSeconds })
      appendEvent(target.dispatch_id, target.id, 'complete', { targetId: target.id, execution: { ...execution, status } })
      recordAudit({ actorType: 'worker', action: 'execution.target.complete', resourceType: 'target', resourceId: target.id, outcome: status, context: { workerIdentity: `api-worker:${process.pid}`, dispatchId: target.dispatch_id, executionId: execution.id, targetIdentity: target.machine_id } })
    }
  } catch (error) {
    clearTimeout(timeout)
    const timestamp = nowIso()
    const retry = target.attempt < target.max_attempts && !runtime.cancelled
    if (retry) { const delay = retryDelay(target.attempt, settings); run("UPDATE job_targets SET status = 'queued', available_at = ?, updated_at = ?, last_error = ? WHERE id = ?", [delayUntil(delay), timestamp, error.message, target.id]); appendEvent(target.dispatch_id, target.id, 'target-retry', { targetId: target.id, attempt: target.attempt, retryInSeconds: delay }) }
    else if (runtime.cancelled) run("UPDATE job_targets SET status = 'cancelled', finished_at = ?, updated_at = ?, last_error = ? WHERE id = ?", [timestamp, timestamp, error.message, target.id])
    else { deadLetter(target, error.message); const circuitOpened = recordCircuitOutcome(target.machine_id, true, error.message, settings); if (circuitOpened) appendEvent(target.dispatch_id, target.id, 'circuit-opened', { machineId: target.machine_id, retryAfterSeconds: settings.circuitOpenSeconds }) }
    appendEvent(target.dispatch_id, target.id, 'stderr', { targetId: target.id, data: error.message })
  } finally {
    activeTargets.delete(target.id)
    refreshDispatch(target.dispatch_id)
  }
}

function expireDispatchDeadlines() {
  const expired = all("SELECT id FROM job_dispatches WHERE deadline_at IS NOT NULL AND deadline_at <= ? AND status IN ('queued', 'running')", [nowIso()])
  expired.forEach(({ id }) => {
    const timestamp = nowIso()
    run("UPDATE job_dispatches SET status = 'timed_out', finished_at = ?, updated_at = ? WHERE id = ?", [timestamp, timestamp, id])
    run("UPDATE job_targets SET status = 'timed_out', finished_at = ?, updated_at = ?, last_error = 'Dispatch deadline exceeded' WHERE dispatch_id = ? AND status = 'queued'", [timestamp, timestamp, id])
    activeTargets.forEach(({ runtime }, targetId) => {
      if (get('SELECT dispatch_id FROM job_targets WHERE id = ?', [targetId])?.dispatch_id === id) { runtime.cancelled = true; runtime.timedOut = true; runtime.cancelActive?.() }
    })
    appendEvent(id, null, 'dispatch-timed-out', { dispatchId: id })
  })
  return expired.length
}

export function listDeadLetters() {
  return all(`SELECT dl.*, m.name AS machine_name, s.name AS script_name FROM job_dead_letters dl JOIN machines m ON m.id = dl.machine_id JOIN library_entries s ON s.id = dl.script_id WHERE dl.resolved_at IS NULL ORDER BY dl.created_at DESC`)
}

export function requeueDeadLetter(id) {
  const letter = get('SELECT * FROM job_dead_letters WHERE id = ? AND resolved_at IS NULL', [id])
  if (!letter) return false
  const timestamp = nowIso()
  transaction(() => {
    run("UPDATE job_dead_letters SET resolved_at = ? WHERE id = ?", [timestamp, id])
    run("UPDATE job_targets SET status = 'queued', attempt = 0, available_at = ?, started_at = NULL, finished_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?", [timestamp, timestamp, letter.target_id])
    run("UPDATE job_dispatches SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ?", [timestamp, letter.dispatch_id])
  })
  appendEvent(letter.dispatch_id, letter.target_id, 'target-requeued', { targetId: letter.target_id, deadLetterId: id })
  return true
}

export function getReliabilityStatus() {
  const settings = runtimeSettings()
  return { ...settings, activeTargets: get("SELECT COUNT(*) AS count FROM job_targets WHERE status = 'running'")?.count || 0, queuedTargets: get("SELECT COUNT(*) AS count FROM job_targets WHERE status = 'queued'")?.count || 0, deadLetters: get('SELECT COUNT(*) AS count FROM job_dead_letters WHERE resolved_at IS NULL')?.count || 0, openCircuits: get("SELECT COUNT(*) AS count FROM machine_circuits WHERE state = 'open' AND open_until > ?", [nowIso()])?.count || 0 }
}

export function refreshDispatchStatus(dispatchId) { return refreshDispatch(dispatchId) }

export async function processQueuedJobs() {
  if (workerRunning) return 0
  const settings = runtimeSettings()
  if (settings.workerMode !== 'active') return 0
  workerRunning = true
  try {
  expireDispatchDeadlines()
  let started = 0
  while (started < settings.maxConcurrentTargets) {
    const target = claimNextTarget(settings)
    if (!target) break
    started += 1
    void executeTarget(target).catch((error) => logger.error({ error: error.message, targetId: target.id }, 'target worker failed'))
  }
  return started
  } finally {
    workerRunning = false
  }
}

export function recoverInterruptedJobs() {
  const timestamp = nowIso()
  const recovered = run("UPDATE job_targets SET status = 'queued', available_at = ?, started_at = NULL, updated_at = ?, last_error = 'Worker restarted while target was running' WHERE status = 'running'", [timestamp, timestamp]).changes
  run("UPDATE job_dispatches SET status = 'queued', updated_at = ? WHERE status = 'running'", [timestamp])
  return recovered
}
