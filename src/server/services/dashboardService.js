import { all, get } from '../db/client.js'

function scopeClause(scope = {}, alias = 'm') {
  const clauses = []; const params = []
  if (scope.projectId) { clauses.push(`${alias}.project_id = ?`); params.push(scope.projectId) }
  if (scope.environmentId) { clauses.push(`${alias}.environment_id = ?`); params.push(scope.environmentId) }
  return { where: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
}
function percentile(values, point) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * point) - 1)].toFixed(1)) }

export function getOperationsDashboard(scope = {}) {
  const project = scope.projectId ? get('SELECT p.organization_id, p.name, o.name AS organization_name FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.id=?', [scope.projectId]) : null
  const scoped = scopeClause(scope); const machineScope = scopeClause(scope, 'm')
  const executionRows = all(`SELECT e.status, e.started_at, e.finished_at, s.name AS script_name, m.name AS machine_name FROM executions e JOIN machines m ON m.id=e.machine_id JOIN library_entries s ON s.id=e.script_id WHERE 1=1${machineScope.where} ORDER BY e.created_at DESC LIMIT 1000`, machineScope.params)
  const durations = executionRows.filter((row) => row.finished_at).map((row) => Math.max(0, (new Date(row.finished_at) - new Date(row.started_at)) / 1000))
  const total = executionRows.length; const successful = executionRows.filter((row) => row.status === 'success').length
  const queue = get(`SELECT COUNT(*) AS queued, SUM(CASE WHEN jt.status='running' THEN 1 ELSE 0 END) AS running FROM job_targets jt JOIN machines m ON m.id=jt.machine_id WHERE jt.status IN ('queued','running')${machineScope.where}`, machineScope.params) || {}
  const workers = get(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='draining' THEN 1 ELSE 0 END) AS draining, SUM(CASE WHEN status='active' AND last_heartbeat_at >= datetime('now','-60 seconds') THEN 1 ELSE 0 END) AS online FROM execution_workers`) || {}
  const drift = get(`SELECT COUNT(*) AS total, SUM(CASE WHEN inventory_state IN ('stale','missing') OR (inventory_last_seen_at IS NOT NULL AND inventory_last_seen_at < datetime('now','-7 days')) THEN 1 ELSE 0 END) AS drifted FROM machines m WHERE 1=1${scoped.where}`, scoped.params) || {}
  const approvals = get(`SELECT COUNT(*) AS pending FROM approvals a LEFT JOIN schedules s ON a.entity_type='schedule' AND a.entity_id=s.id WHERE a.status='pending'${scope.environmentId ? ' AND (s.environment_id=? OR a.entity_type <> \'schedule\')' : ''}`, scope.environmentId ? [scope.environmentId] : []) || {}
  const notification = get("SELECT COUNT(*) AS failures, MAX(created_at) AS last_event_at FROM logs WHERE channel='notification' AND level='error' AND created_at >= datetime('now','-24 hours')") || {}
  const targetFailures = all(`SELECT m.name, COUNT(*) AS failures FROM executions e JOIN machines m ON m.id=e.machine_id WHERE e.status <> 'success'${machineScope.where} GROUP BY m.id ORDER BY failures DESC, m.name LIMIT 6`, machineScope.params)
  return { scope: { ...scope, organizationId: project?.organization_id || '', organizationName: project?.organization_name || '', projectName: project?.name || '' }, queue: { queued: Number(queue.queued || 0), running: Number(queue.running || 0) }, workers: { total: Number(workers.total || 0), online: Number(workers.online || 0), draining: Number(workers.draining || 0) }, success: { total, successful, rate: total ? Number((successful * 100 / total).toFixed(1)) : 100 }, duration: { p50: percentile(durations, .5), p95: percentile(durations, .95), p99: percentile(durations, .99) }, targetFailures, inventory: { total: Number(drift.total || 0), drifted: Number(drift.drifted || 0) }, approvals: { pending: Number(approvals.pending || 0) }, notifications: { failures24h: Number(notification.failures || 0), lastEventAt: notification.last_event_at || null, healthy: !Number(notification.failures || 0) }, recentExecutions: executionRows.slice(0, 12) }
}

export function getDashboardSummary() {
  const counts = {
    users: get('SELECT COUNT(*) AS count FROM users').count,
    teams: get('SELECT COUNT(*) AS count FROM teams').count,
    scripts: get("SELECT COUNT(*) AS count FROM library_entries WHERE type = 'script'").count,
    machines: get('SELECT COUNT(*) AS count FROM machines').count,
    groups: get('SELECT COUNT(*) AS count FROM deployment_groups').count,
    schedules: get('SELECT COUNT(*) AS count FROM schedules').count,
    runs: get('SELECT COUNT(*) AS count FROM executions').count,
    failures:
      get("SELECT COUNT(*) AS count FROM executions WHERE status IN ('failed', 'error')").count,
  }

  const recentExecutions = all(
    `SELECT e.id, e.status, e.started_at, e.finished_at, e.exit_code, s.name AS script_name, m.name AS machine_name
     FROM executions e
     JOIN library_entries s ON s.id = e.script_id
     JOIN machines m ON m.id = e.machine_id
     ORDER BY e.created_at DESC
     LIMIT 10`,
  )

  const upcomingSchedules = all(
    `SELECT id, name, cron_expression, next_run_at, status
     FROM schedules
     WHERE status = 'enabled'
     ORDER BY next_run_at ASC
     LIMIT 10`,
  )

  const machineHealth = all(
    `SELECT id, name, transport, os_family, last_test_status, last_tested_at
     FROM machines
     ORDER BY name ASC
     LIMIT 10`,
  )

  return {
    counts,
    recentExecutions,
    upcomingSchedules,
    machineHealth,
  }
}
