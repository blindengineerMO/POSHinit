import { all } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'
import { getSettings } from './settingsService.js'

export function getCatalog() {
  const users = all(
    'SELECT id, name, email, role, status, created_at, updated_at FROM users ORDER BY name ASC',
  )
  const teams = all(
    `SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
            COALESCE(json_group_array(tm.user_id), '[]') AS member_ids_json
     FROM teams t
     LEFT JOIN team_members tm ON tm.team_id = t.id
     GROUP BY t.id
     ORDER BY t.name ASC`,
  ).map((team) => ({
    ...team,
    memberIds: JSON.parse(team.member_ids_json).filter(Boolean),
  }))
  const credentials = all(
    `SELECT id, name, scope, owner_user_id, team_ids_json, username, domain_name, protocol,
            notes, created_at, updated_at
     FROM credentials
     ORDER BY name ASC`,
  ).map((credential) => ({
    ...credential,
    teamIds: JSON.parse(credential.team_ids_json || '[]'),
  }))
  const machines = all(
    `SELECT id, name, fqdn, ip_address, notes, os_family, transport, port, credential_id, source_type,
            source_ref, last_tested_at, last_test_status, last_test_output, created_at, updated_at
     FROM machines
     ORDER BY name ASC`,
  )
  const groups = all(
    `SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
            COALESCE(json_group_array(dgm.machine_id), '[]') AS machine_ids_json
     FROM deployment_groups g
     LEFT JOIN deployment_group_machines dgm ON dgm.group_id = g.id
     GROUP BY g.id
     ORDER BY g.name ASC`,
  ).map((group) => ({
    ...group,
    machineIds: JSON.parse(group.machine_ids_json).filter(Boolean),
  }))
  const schedules = all(
    `SELECT s.id, s.name, s.cron_expression, s.timezone, s.mode, s.run_at, s.status, s.require_approval,
            s.next_run_at, s.last_run_at, s.created_by, s.created_at, s.updated_at,
            COALESCE(json_group_array(DISTINCT ss.script_id), '[]') AS script_ids_json,
            COALESCE(json_group_array(DISTINCT CASE WHEN st.target_type = 'group' THEN st.target_id END), '[]') AS group_ids_json,
            COALESCE(json_group_array(DISTINCT CASE WHEN st.target_type = 'machine' THEN st.target_id END), '[]') AS machine_ids_json
     FROM schedules s
     LEFT JOIN schedule_scripts ss ON ss.schedule_id = s.id
     LEFT JOIN schedule_targets st ON st.schedule_id = s.id
     GROUP BY s.id
     ORDER BY s.name ASC`,
  ).map((schedule) => ({
    ...schedule,
    requireApproval: Boolean(schedule.require_approval),
    scriptIds: JSON.parse(schedule.script_ids_json).filter(Boolean),
    groupIds: JSON.parse(schedule.group_ids_json).filter(Boolean),
    machineIds: JSON.parse(schedule.machine_ids_json).filter(Boolean),
  }))
  const executions = all(
    `SELECT e.id, e.trigger_type, e.schedule_id, e.script_id, e.machine_id, e.status, e.requested_by,
            e.started_at, e.finished_at, e.exit_code, e.stdout, e.stderr, e.report_json, e.created_at,
            s.name AS script_name, m.name AS machine_name
     FROM executions e
     JOIN library_entries s ON s.id = e.script_id
     JOIN machines m ON m.id = e.machine_id
     ORDER BY e.created_at DESC
     LIMIT 200`,
  ).map((execution) => ({
    ...execution,
    report: JSON.parse(execution.report_json || '{}'),
  }))
  const settings = getSettings()

  settings.vcenter = {
    ...settings.vcenter,
    passwordMasked:
      settings.vcenter.passwordEncrypted && decryptSecret(settings.vcenter.passwordEncrypted)
        ? '********'
        : '',
  }

  return {
    users,
    teams,
    credentials,
    machines,
    groups,
    schedules,
    executions,
    settings,
  }
}
