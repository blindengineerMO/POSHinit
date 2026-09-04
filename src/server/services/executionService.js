import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { writeLog } from './logService.js'
import { executeLocalPowerShell } from './powershellService.js'
import { computeNextRun, getDueSchedules, markScheduleExecuted } from './scheduleService.js'

function buildTargetMachines(scheduleId) {
  const machineIds = new Set()
  const directTargets = all(
    "SELECT target_id FROM schedule_targets WHERE schedule_id = ? AND target_type = 'machine'",
    [scheduleId],
  )
  directTargets.forEach((target) => machineIds.add(target.target_id))

  const groupTargets = all(
    "SELECT target_id FROM schedule_targets WHERE schedule_id = ? AND target_type = 'group'",
    [scheduleId],
  )
  groupTargets.forEach((target) => {
    all('SELECT machine_id FROM deployment_group_machines WHERE group_id = ?', [target.target_id]).forEach(
      (row) => machineIds.add(row.machine_id),
    )
  })

  return [...machineIds]
}

async function runExecution({ triggerType, scheduleId = null, scriptId, machineId, requestedBy = null }) {
  const executionId = nanoid()
  const startedAt = nowIso()
  const script = get('SELECT id, name, content FROM library_entries WHERE id = ?', [scriptId])
  const machine = get('SELECT id, name, transport FROM machines WHERE id = ?', [machineId])

  run(
    `INSERT INTO executions (
       id, trigger_type, schedule_id, script_id, machine_id, status, requested_by, started_at,
       finished_at, exit_code, stdout, stderr, report_json, created_at
     ) VALUES (
       @id, @triggerType, @scheduleId, @scriptId, @machineId, 'running', @requestedBy, @startedAt,
       NULL, NULL, '', '', '{}', @createdAt
     )`,
    {
      id: executionId,
      triggerType,
      scheduleId,
      scriptId,
      machineId,
      requestedBy,
      startedAt,
      createdAt: startedAt,
    },
  )

  writeLog('info', 'execution', `Execution started for ${script.name} on ${machine.name}`, {
    executionId,
    scriptId,
    machineId,
    triggerType,
  })

  let result
  try {
    if (machine.transport !== 'local') {
      throw new Error('Only local transport execution is currently supported by the scheduler')
    }

    result = await executeLocalPowerShell(script.content)
  } catch (error) {
    result = {
      code: 1,
      stdout: '',
      stderr: error.message,
    }
  }

  const status = result.code === 0 ? 'success' : 'failed'
  const finishedAt = nowIso()
  const report = {
    machineName: machine.name,
    scriptName: script.name,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    summary:
      status === 'success'
        ? 'Run completed without PowerShell errors.'
        : 'Run failed. Inspect stderr and full log stream.',
  }

  run(
    `UPDATE executions
     SET status = @status,
         finished_at = @finishedAt,
         exit_code = @exitCode,
         stdout = @stdout,
         stderr = @stderr,
         report_json = @reportJson
     WHERE id = @id`,
    {
      id: executionId,
      status,
      finishedAt,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      reportJson: JSON.stringify(report),
    },
  )

  writeLog(
    status === 'success' ? 'info' : 'error',
    'execution',
    `Execution ${status} for ${script.name} on ${machine.name}`,
    {
      executionId,
      exitCode: result.code,
    },
  )

  return get('SELECT * FROM executions WHERE id = ?', [executionId])
}

export async function executeAdHocRun(payload, requestedBy) {
  const machineIds = payload.machineIds || []
  const scriptIds = payload.scriptIds || []
  const results = []

  for (const scriptId of scriptIds) {
    for (const machineId of machineIds) {
      // Sequential execution keeps reports deterministic during the first implementation pass.
      // The service boundary keeps it ready for a real job queue later.
      // eslint-disable-next-line no-await-in-loop
      const result = await runExecution({
        triggerType: payload.triggerType || 'manual',
        scriptId,
        machineId,
        requestedBy,
      })
      results.push(result)
    }
  }

  return results
}

export async function processDueSchedules() {
  const schedules = getDueSchedules()

  for (const schedule of schedules) {
    const scriptIds = all('SELECT script_id FROM schedule_scripts WHERE schedule_id = ?', [schedule.id]).map(
      (row) => row.script_id,
    )
    const machineIds = buildTargetMachines(schedule.id)

    for (const scriptId of scriptIds) {
      for (const machineId of machineIds) {
        // eslint-disable-next-line no-await-in-loop
        await runExecution({
          triggerType: 'schedule',
          scheduleId: schedule.id,
          scriptId,
          machineId,
          requestedBy: schedule.created_by,
        })
      }
    }

    const nextRunAt = schedule.mode === 'once' ? null : computeNextRun(schedule, new Date())
    markScheduleExecuted(schedule.id, nextRunAt)
  }

  return schedules.length
}
