import { nanoid } from 'nanoid'
import { Client as SshClient } from 'ssh2'
import { all, get, nowIso, run } from '../db/client.js'
import { writeLog } from './logService.js'
import { decryptSecret } from '../utils/crypto.js'
import { executeLocalPowerShell, executePsRemoting, streamLocalPowerShell, streamPsRemoting } from './powershellService.js'
import { computeNextRun, getDueSchedules, markScheduleExecuted } from './scheduleService.js'
import { injectSecretTemplates } from './secretInjectionService.js'
import { sendExecutionAlert } from './notificationService.js'
import { dispatchNotificationEvent } from './notificationPolicyService.js'
import { requestScheduleApproval } from './approvalService.js'

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

function parameterPreamble(values = {}) {
  const encoded = Buffer.from(JSON.stringify(values), 'utf8').toString('base64')
  return `$__poshinitParameters = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json; $__poshinitParameters.psobject.Properties | ForEach-Object { Set-Variable -Name $_.Name -Value $_.Value -Scope Local }\n`
}

function executeSshPowerShell(machine, credential, content) {
  return new Promise((resolve, reject) => {
    const client = new SshClient()
    const encoded = Buffer.from(content, 'utf8').toString('base64')
    client.on('ready', () => client.exec(`echo ${encoded} | base64 -d | pwsh -NoProfile -NonInteractive -Command -`, (error, stream) => {
      if (error) return reject(error)
      let stdout = ''; let stderr = ''
      stream.on('data', (chunk) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      stream.on('close', (code) => { client.end(); resolve({ code, stdout, stderr }) })
    })).on('error', reject).connect({ host: machine.fqdn || machine.ip_address, port: machine.port || 22, username: credential.username, password: decryptSecret(credential.secret_encrypted), readyTimeout: 20000 })
  })
}

async function runExecution({ triggerType, scheduleId = null, scriptId, machineId, requestedBy = null, onOutput = null }) {
  const executionId = nanoid()
  const startedAt = nowIso()
  const script = get('SELECT id, name, content FROM library_entries WHERE id = ?', [scriptId])
  const machine = get('SELECT * FROM machines WHERE id = ?', [machineId])

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
  let executableContent
  try {
    // Templates are resolved only in memory after the run has been recorded.
    const scheduleValues = scheduleId ? JSON.parse(get('SELECT parameters_json FROM schedule_scripts WHERE schedule_id = ? AND script_id = ?', [scheduleId, scriptId])?.parameters_json || '{}') : {}
    executableContent = parameterPreamble(scheduleValues) + injectSecretTemplates(script.content)
    if (!onOutput && machine.transport === 'local') {
      result = await executeLocalPowerShell(executableContent)
    } else if (!onOutput && machine.transport === 'psremoting') {
      const credential = machine.credential_id
        ? get('SELECT * FROM credentials WHERE id = ?', [machine.credential_id])
        : null
      if (!credential) {
        throw new Error('PowerShell remoting target is missing a credential')
      }
      if (credential.protocol !== 'psremoting') {
        throw new Error('PowerShell remoting target requires a psremoting credential')
      }

      const username = credential.domain_name && !credential.username.includes('\\') && !credential.username.includes('@')
        ? `${credential.domain_name}\\${credential.username}`
        : credential.username
      result = await executePsRemoting({
        target: machine.fqdn || machine.ip_address,
        port: machine.port || 5985,
        username,
        password: decryptSecret(credential.secret_encrypted),
        content: executableContent,
      })
    } else if (!onOutput) {
      if (machine.transport !== 'ssh') throw new Error(`Execution transport is not supported: ${machine.transport}`)
      const credential = machine.credential_id ? get('SELECT * FROM credentials WHERE id = ?', [machine.credential_id]) : null
      if (!credential || credential.protocol !== 'ssh') throw new Error('SSH target requires an SSH credential')
      result = await executeSshPowerShell(machine, credential, executableContent)
    } else {
      const credential = machine.transport === 'psremoting' ? get('SELECT * FROM credentials WHERE id = ?', [machine.credential_id]) : null
      const options = machine.transport === 'psremoting' ? { target: machine.fqdn || machine.ip_address, port: machine.port || 5985, username: credential?.domain_name ? `${credential.domain_name}\\${credential.username}` : credential?.username, password: decryptSecret(credential?.secret_encrypted || ''), content: executableContent } : null
      if (machine.transport === 'psremoting' && (!credential || credential.protocol !== 'psremoting')) throw new Error('PowerShell remoting target requires a psremoting credential')
      result = await new Promise((resolve, reject) => {
        let stdout = ''; let stderr = ''
        const handlers = { onStdout: (data) => { stdout += data; onOutput({ executionId, type: 'stdout', data }) }, onStderr: (data) => { stderr += data; onOutput({ executionId, type: 'stderr', data }) }, onClose: (code) => resolve({ code, stdout, stderr }), onError: reject }
        if (machine.transport === 'local') streamLocalPowerShell(executableContent, handlers)
        else if (machine.transport === 'psremoting') streamPsRemoting(options, handlers)
        else reject(new Error(`Execution transport is not supported: ${machine.transport}`))
      })
    }
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

  const execution = get('SELECT * FROM executions WHERE id = ?', [executionId])
  await sendExecutionAlert({
    id: executionId,
    status,
    triggerType,
    scriptName: script.name,
    machineName: machine.name,
    startedAt,
    finishedAt,
    durationMs: report.durationMs,
    exitCode: result.code,
    stderr: result.stderr,
  })
  await dispatchNotificationEvent({
    type: status === 'success' ? 'job.success' : 'job.failed',
    title: `${script.name} ${status} on ${machine.name}`,
    summary: status === 'success' ? report.summary : String(result.stderr || report.summary).slice(0, 1000),
    url: `/reports?execution=${executionId}`,
    occurredAt: finishedAt,
    details: { executionId, scriptId, machineId, status, exitCode: result.code },
  })
  return execution
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

export async function executeAdHocRunStream(payload, requestedBy, onOutput) {
  const results = []
  for (const scriptId of payload.scriptIds || []) {
    for (const machineId of payload.machineIds || []) {
      // Keep dispatch ordered while allowing each target to emit output immediately.
      // eslint-disable-next-line no-await-in-loop
      const result = await runExecution({ triggerType: payload.triggerType || 'manual', scriptId, machineId, requestedBy, onOutput })
      results.push(result)
      onOutput({ executionId: result.id, type: 'complete', execution: result })
    }
  }
  return results
}

export async function executeScheduleWebhook(scheduleId) {
  const schedule = get('SELECT id, created_by FROM schedules WHERE id = ?', [scheduleId])
  if (!schedule) {
    throw new Error('Schedule not found')
  }
  const scriptIds = all('SELECT script_id FROM schedule_scripts WHERE schedule_id = ?', [scheduleId]).map((row) => row.script_id)
  const machineIds = buildTargetMachines(scheduleId)
  const results = []

  for (const scriptId of scriptIds) {
    for (const machineId of machineIds) {
      // Sequential execution preserves ordered webhook results and prevents target contention.
      // eslint-disable-next-line no-await-in-loop
      results.push(await runExecution({ triggerType: 'schedule-webhook', scheduleId, scriptId, machineId, requestedBy: schedule.created_by }))
    }
  }
  return results
}

export async function executeApprovedSchedule(scheduleId, requestedBy) {
  const schedule = get('SELECT id, created_by FROM schedules WHERE id = ?', [scheduleId])
  if (!schedule) throw new Error('Schedule not found')
  const scriptIds = all('SELECT script_id FROM schedule_scripts WHERE schedule_id = ?', [scheduleId]).map((row) => row.script_id)
  const machineIds = buildTargetMachines(scheduleId)
  const results = []
  for (const scriptId of scriptIds) for (const machineId of machineIds) results.push(await runExecution({ triggerType: 'approval', scheduleId, scriptId, machineId, requestedBy }))
  return results
}

export async function processDueSchedules() {
  const schedules = getDueSchedules()

  for (const schedule of schedules) {
    if (schedule.require_approval) {
      requestScheduleApproval(schedule)
      markScheduleExecuted(schedule.id, schedule.mode === 'once' ? null : computeNextRun(schedule, new Date()))
      continue
    }
    const scriptIds = all('SELECT script_id FROM schedule_scripts WHERE schedule_id = ?', [schedule.id]).map(
      (row) => row.script_id,
    )
    const machineIds = buildTargetMachines(schedule.id)

    for (const scriptId of scriptIds) {
      await Promise.all(machineIds.map((machineId) => runExecution({ triggerType: 'schedule', scheduleId: schedule.id, scriptId, machineId, requestedBy: schedule.created_by })))
    }

    const nextRunAt = schedule.mode === 'once' ? null : computeNextRun(schedule, new Date())
    markScheduleExecuted(schedule.id, nextRunAt)
  }

  return schedules.length
}
