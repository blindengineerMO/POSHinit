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
import { getApprovalEvidence, requestScheduleApproval } from './approvalService.js'
import { syncDynamicGroups } from './groupService.js'
import { redactText } from './outputRedactionService.js'
import { resolveParameterValues } from './parameterService.js'

const activeDispatches = new Map()

export function buildTargetMachines(scheduleId) {
  syncDynamicGroups()
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

function streamSshPowerShell(machine, credential, content, handlers) {
  const client = new SshClient()
  const encoded = Buffer.from(content, 'utf8').toString('base64')
  let closed = false
  const close = (code) => {
    if (closed) return
    closed = true
    client.end()
    handlers.onClose?.(code)
  }
  const fail = (error) => {
    if (closed) return
    closed = true
    client.end()
    handlers.onError?.(error)
  }
  client.on('ready', () => {
    client.exec(`echo ${encoded} | base64 -d | pwsh -NoProfile -NonInteractive -Command -`, (error, stream) => {
      if (error) return fail(error)
      stream.on('data', (chunk) => handlers.onStdout?.(chunk.toString()))
      stream.stderr.on('data', (chunk) => handlers.onStderr?.(chunk.toString()))
      stream.on('close', close)
      return undefined
    })
  }).on('error', fail).connect({
    host: machine.fqdn || machine.ip_address,
    port: machine.port || 22,
    username: credential.username,
    password: decryptSecret(credential.secret_encrypted),
    readyTimeout: 20000,
  })
  return { cancel: () => { if (!closed) { closed = true; client.end(); handlers.onClose?.(130) } } }
}

export async function runExecution({ triggerType, scheduleId = null, scriptId, machineId, requestedBy = null, onOutput = null, dispatch = null }) {
  const executionId = nanoid()
  const startedAt = nowIso()
  const script = get('SELECT id, name, content, parameter_schema_json FROM library_entries WHERE id = ?', [scriptId])
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
  let executionSecretValues = []
  const redactExecutionOutput = (value) => redactText(dispatch?.redactOutput ? dispatch.redactOutput(value) : value, executionSecretValues)
  try {
    // Templates are resolved only in memory after the run has been recorded.
    const storedParameters = scheduleId ? JSON.parse(get('SELECT parameters_json FROM schedule_scripts WHERE schedule_id = ? AND script_id = ?', [scheduleId, scriptId])?.parameters_json || '{}') : {}
    const resolvedParameters = resolveParameterValues(JSON.parse(script.parameter_schema_json || '[]'), storedParameters)
    executionSecretValues.push(...resolvedParameters.sensitiveValues)
    const injected = await injectSecretTemplates(script.content, { executionId, scriptId, machineId })
    executionSecretValues = injected.secretValues
    executableContent = parameterPreamble(resolvedParameters.values) + injected.content
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
      const credential = machine.transport === 'local' ? null : get('SELECT * FROM credentials WHERE id = ?', [machine.credential_id])
      const options = machine.transport === 'psremoting' ? { target: machine.fqdn || machine.ip_address, port: machine.port || 5985, username: credential?.domain_name ? `${credential.domain_name}\\${credential.username}` : credential?.username, password: decryptSecret(credential?.secret_encrypted || ''), content: executableContent } : null
      if (machine.transport === 'psremoting' && (!credential || credential.protocol !== 'psremoting')) throw new Error('PowerShell remoting target requires a psremoting credential')
      if (machine.transport === 'ssh' && (!credential || credential.protocol !== 'ssh')) throw new Error('SSH target requires an SSH credential')
      if (dispatch?.cancelled) throw new Error('Execution cancelled by operator')
      result = await new Promise((resolve, reject) => {
        let stdout = ''; let stderr = ''
        const handlers = {
          onStdout: (data) => { const safeData = redactExecutionOutput(data); stdout += safeData; onOutput({ executionId, type: 'stdout', data: safeData }) },
          onStderr: (data) => { const safeData = redactExecutionOutput(data); stderr += safeData; onOutput({ executionId, type: 'stderr', data: safeData }) },
          onClose: (code) => resolve({ code, stdout, stderr }),
          onError: reject,
        }
        let runner
        if (machine.transport === 'local') runner = streamLocalPowerShell(executableContent, handlers)
        else if (machine.transport === 'psremoting') runner = streamPsRemoting(options, handlers)
        else if (machine.transport === 'ssh') runner = streamSshPowerShell(machine, credential, executableContent, handlers)
        else reject(new Error(`Execution transport is not supported: ${machine.transport}`))
        if (runner && dispatch) dispatch.cancelActive = () => runner.cancel ? runner.cancel() : runner.kill('SIGTERM')
      })
    }
  } catch (error) {
    result = {
      code: dispatch?.timedOut ? 124 : dispatch?.cancelled ? 130 : 1,
      stdout: '',
      stderr: dispatch?.timedOut ? 'Execution timed out' : dispatch?.cancelled ? 'Execution cancelled by operator' : error.message,
    }
  }

  result.stdout = redactExecutionOutput(result.stdout)
  result.stderr = redactExecutionOutput(result.stderr)

  const status = dispatch?.timedOut ? 'timed_out' : dispatch?.cancelled || result.code === 130 ? 'cancelled' : result.code === 0 ? 'success' : 'failed'
  const finishedAt = nowIso()
  const report = {
    machineName: machine.name,
    scriptName: script.name,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    summary:
      status === 'success'
        ? 'Run completed without PowerShell errors.'
        : status === 'cancelled'
          ? 'Run was cancelled by an operator.'
          : status === 'timed_out'
            ? 'Run exceeded its configured timeout.'
          : 'Run failed. Inspect stderr and full log stream.',
  }
  if (scheduleId) report.approvalEvidence = getApprovalEvidence(scheduleId)

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
    status === 'success' ? 'info' : ['cancelled', 'timed_out'].includes(status) ? 'warning' : 'error',
    'execution',
    `Execution ${status} for ${script.name} on ${machine.name}`,
    {
      executionId,
      exitCode: result.code,
    },
  )

  const execution = get('SELECT * FROM executions WHERE id = ?', [executionId])
  if (!['cancelled', 'timed_out'].includes(status)) {
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
  }
  return execution
}

export async function executeAdHocRun(payload, requestedBy) {
  const { enqueueDispatch } = await import('./jobQueueService.js')
  return enqueueDispatch(payload, requestedBy)
}

export function startAdHocRunStream(payload, requestedBy, onOutput) {
  const dispatch = { id: nanoid(), cancelled: false, cancelActive: null }
  activeDispatches.set(dispatch.id, dispatch)
  const promise = executeAdHocRunStream(payload, requestedBy, onOutput, dispatch)
    .finally(() => activeDispatches.delete(dispatch.id))
  return { dispatchId: dispatch.id, promise }
}

export function cancelAdHocRunStream(dispatchId) {
  const dispatch = activeDispatches.get(dispatchId)
  if (!dispatch) return false
  dispatch.cancelled = true
  dispatch.cancelActive?.()
  return true
}

export async function executeAdHocRunStream(payload, requestedBy, onOutput, dispatch = null) {
  const results = []
  for (const scriptId of payload.scriptIds || []) {
    for (const machineId of payload.machineIds || []) {
      if (dispatch?.cancelled) return results
      // Keep dispatch ordered while allowing each target to emit output immediately.
      // eslint-disable-next-line no-await-in-loop
      const result = await runExecution({ triggerType: payload.triggerType || 'manual', scriptId, machineId, requestedBy, onOutput, dispatch })
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
  const { enqueueScheduleDispatch } = await import('./jobQueueService.js')
  return enqueueScheduleDispatch(scheduleId, 'schedule-webhook', schedule.created_by)
}

export async function executeApprovedSchedule(scheduleId, requestedBy) {
  const schedule = get('SELECT id, created_by FROM schedules WHERE id = ?', [scheduleId])
  if (!schedule) throw new Error('Schedule not found')
  const { enqueueScheduleDispatch } = await import('./jobQueueService.js')
  return enqueueScheduleDispatch(scheduleId, 'approval', requestedBy)
}

export async function processDueSchedules() {
  const schedules = getDueSchedules()

  for (const schedule of schedules) {
    if (schedule.require_approval) {
      requestScheduleApproval(schedule)
      markScheduleExecuted(schedule.id, schedule.mode === 'once' ? null : computeNextRun(schedule, new Date()))
      continue
    }
    const { enqueueScheduleDispatch } = await import('./jobQueueService.js')
    enqueueScheduleDispatch(schedule.id, 'schedule', schedule.created_by)

    const nextRunAt = schedule.mode === 'once' ? null : computeNextRun(schedule, new Date())
    markScheduleExecuted(schedule.id, nextRunAt)
  }

  return schedules.length
}
