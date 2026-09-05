import { CronExpressionParser } from 'cron-parser'
import crypto from 'node:crypto'
import { nanoid } from 'nanoid'
import { all, get, nowIso, run, transaction } from '../db/client.js'

export function computeNextRun(schedule, fromDate = new Date()) {
  if ((schedule.mode || schedule.mode) === 'once') {
    return schedule.runAt || schedule.run_at || null
  }

  const expression = schedule.cronExpression || schedule.cron_expression
  if (!expression) {
    return null
  }

  const interval = CronExpressionParser.parse(expression, {
    currentDate: fromDate,
  })

  return interval.next().toISOString()
}

export function listSchedules() {
  return all(
    `SELECT s.id, s.name, s.cron_expression, s.timezone, s.mode, s.run_at, s.status, s.require_approval,
            s.next_run_at, s.last_run_at, s.created_by, s.webhook_enabled, s.created_at, s.updated_at,
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
    webhookEnabled: Boolean(schedule.webhook_enabled),
    scriptIds: JSON.parse(schedule.script_ids_json).filter(Boolean),
    groupIds: JSON.parse(schedule.group_ids_json).filter(Boolean),
    machineIds: JSON.parse(schedule.machine_ids_json).filter(Boolean),
  }))
}

export function saveSchedule(payload, createdBy) {
  const scheduleId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id ? get('SELECT created_at, webhook_key, webhook_token FROM schedules WHERE id = ?', [payload.id]) : null
  const scheduleData = {
    id: scheduleId,
    name: payload.name,
    cronExpression: payload.cronExpression || null,
    timezone: payload.timezone || 'UTC',
    mode: payload.mode || 'recurring',
    runAt: payload.runAt || null,
    status: payload.status || 'enabled',
    requireApproval: payload.requireApproval ? 1 : 0,
    webhookEnabled: payload.webhookEnabled ? 1 : 0,
    webhookKey: payload.webhookEnabled ? existing?.webhook_key || crypto.randomBytes(24).toString('base64url') : null,
    webhookToken: payload.webhookEnabled ? existing?.webhook_token || crypto.randomBytes(32).toString('base64url') : null,
  }
  const nextRunAt =
    scheduleData.mode === 'once' ? scheduleData.runAt : computeNextRun(scheduleData)

  transaction(() => {
    run(
      `INSERT INTO schedules (
         id, name, cron_expression, timezone, mode, run_at, status, require_approval, webhook_enabled, webhook_key, webhook_token,
         next_run_at, last_run_at, created_by, created_at, updated_at
       ) VALUES (
         @id, @name, @cronExpression, @timezone, @mode, @runAt, @status, @requireApproval, @webhookEnabled, @webhookKey, @webhookToken,
         @nextRunAt, NULL, @createdBy, @createdAt, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         cron_expression = excluded.cron_expression,
         timezone = excluded.timezone,
         mode = excluded.mode,
         run_at = excluded.run_at,
         status = excluded.status,
         require_approval = excluded.require_approval,
         webhook_enabled = excluded.webhook_enabled,
         webhook_key = excluded.webhook_key,
         webhook_token = excluded.webhook_token,
         next_run_at = excluded.next_run_at,
         updated_at = excluded.updated_at`,
      {
        id: scheduleId,
        name: scheduleData.name,
        cronExpression: scheduleData.cronExpression,
        timezone: scheduleData.timezone,
        mode: scheduleData.mode,
        runAt: scheduleData.runAt,
        status: scheduleData.status,
        requireApproval: scheduleData.requireApproval,
        webhookEnabled: scheduleData.webhookEnabled,
        webhookKey: scheduleData.webhookKey,
        webhookToken: scheduleData.webhookToken,
        nextRunAt,
        createdBy,
        createdAt: existing?.created_at || timestamp,
        updatedAt: timestamp,
      },
    )

    run('DELETE FROM schedule_scripts WHERE schedule_id = ?', [scheduleId])
    ;(payload.scriptIds || []).forEach((scriptId) => {
      run(
        'INSERT INTO schedule_scripts (schedule_id, script_id, parameters_json) VALUES (@scheduleId, @scriptId, @parametersJson)',
        {
          scheduleId,
          scriptId,
          parametersJson: JSON.stringify(payload.parameters?.[scriptId] || {}),
        },
      )
    })

    run('DELETE FROM schedule_targets WHERE schedule_id = ?', [scheduleId])
    ;(payload.groupIds || []).forEach((groupId) => {
      run(
        'INSERT INTO schedule_targets (schedule_id, target_type, target_id) VALUES (@scheduleId, @targetType, @targetId)',
        {
          scheduleId,
          targetType: 'group',
          targetId: groupId,
        },
      )
    })
    ;(payload.machineIds || []).forEach((machineId) => {
      run(
        'INSERT INTO schedule_targets (schedule_id, target_type, target_id) VALUES (@scheduleId, @targetType, @targetId)',
        {
          scheduleId,
          targetType: 'machine',
          targetId: machineId,
        },
      )
    })
  })

  return get('SELECT * FROM schedules WHERE id = ?', [scheduleId])
}

export function getDueSchedules() {
  return all(
    `SELECT id, name, cron_expression, timezone, mode, run_at, status, require_approval,
            next_run_at, last_run_at, created_by, created_at, updated_at
     FROM schedules
     WHERE status = 'enabled' AND next_run_at IS NOT NULL AND next_run_at <= @now
     ORDER BY next_run_at ASC`,
    { now: nowIso() },
  )
}

export function getScheduleWebhook(scheduleId) {
  return get('SELECT id, name, webhook_enabled, webhook_key, webhook_token FROM schedules WHERE id = ?', [scheduleId])
}

export function getWebhookSchedule(scheduleId, webhookKey) {
  return get(
    `SELECT id, name, status, mode, next_run_at, last_run_at, created_by, webhook_enabled, webhook_key, webhook_token
     FROM schedules WHERE id = ? AND webhook_key = ? AND webhook_enabled = 1`,
    [scheduleId, webhookKey],
  )
}

export function getScheduleWebhookStatus(scheduleId) {
  const schedule = get('SELECT id, name, status, mode, next_run_at, last_run_at FROM schedules WHERE id = ?', [scheduleId])
  const latest = get(
    `SELECT status, started_at, finished_at, exit_code FROM executions
     WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1`,
    [scheduleId],
  )
  return { ...schedule, running: Boolean(get("SELECT 1 AS active FROM executions WHERE schedule_id = ? AND status = 'running' LIMIT 1", [scheduleId])?.active), latestExecution: latest || null }
}

export function markScheduleExecuted(scheduleId, nextRunAt) {
  run(
    `UPDATE schedules
     SET last_run_at = @lastRunAt,
         next_run_at = @nextRunAt,
         status = CASE WHEN mode = 'once' THEN 'disabled' ELSE status END
     WHERE id = @id`,
    {
      id: scheduleId,
      lastRunAt: nowIso(),
      nextRunAt,
    },
  )
}
