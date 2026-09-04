import { all, get } from '../db/client.js'

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
