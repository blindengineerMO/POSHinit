import { Client as SshClient } from 'ssh2'
import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'
import { executeLocalPowerShell, executePsRemoting, streamLocalPowerShell, streamPsRemoting } from './powershellService.js'
import { writeLog } from './logService.js'
import { redactOutput } from './outputRedactionService.js'
import { getRemoteSessionSettings } from './settingsService.js'
import { recordAudit } from './auditService.js'

const sessions = new Map()

function pruneRetainedSessions() { const policy = getRemoteSessionSettings(); const cutoff = new Date(Date.now() - policy.retentionDays * 86400000).toISOString(); run('DELETE FROM remote_sessions WHERE opened_at < ?', [cutoff]) }

function recordEvent(sessionId, type, content = '', metadata = {}) {
  if (!getRemoteSessionSettings().recordSessions) return
  const sequence = (get('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM remote_session_events WHERE session_id = ?', [sessionId])?.sequence || 0) + 1
  run('INSERT INTO remote_session_events (id,session_id,sequence,event_type,content,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)', [nanoid(), sessionId, sequence, type, redactOutput(content).slice(0, 100000), JSON.stringify(metadata), nowIso()])
}
function persistSession(id, session) { const policy = getRemoteSessionSettings(); run('INSERT INTO remote_sessions (id,machine_id,requested_by,transport,status,recording_enabled,opened_at,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, session.machine.id, session.requestedBy || null, session.transport, 'connected', Number(policy.recordSessions), nowIso(), nowIso()]); if (policy.recordSessions) recordEvent(id, 'connected', '', { machineId: session.machine.id, transport: session.transport }) }
function recordOutput(sessionId, type, data) { if (getRemoteSessionSettings().recordSessions) recordEvent(sessionId, type, data) }
function policyForClient() { return getRemoteSessionSettings() }

export function cleanTerminalOutput(value) {
  return String(value || '')
    // OSC sequences (for titles, hyperlinks, etc.) terminate with BEL or ST.
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?/g, '')
    // CSI sequences control cursor position, colors, bracketed paste, and alternate screens.
    .replace(/[\u001B\u009B]\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u001B\u009B][()][0-2AB]/g, '')
    .replace(/\r/g, '')
}

function cleanTerminalResult(result) {
  return { ...result, stdout: cleanTerminalOutput(result.stdout), stderr: cleanTerminalOutput(result.stderr) }
}

function credentialFor(machine) {
  if (!machine.credential_id) throw new Error('Machine has no assigned credential')
  const credential = get('SELECT * FROM credentials WHERE id = ?', [machine.credential_id])
  if (!credential) throw new Error('Assigned credential was not found')
  return credential
}

function usernameFor(credential) {
  return credential.domain_name && !credential.username.includes('\\') && !credential.username.includes('@')
    ? `${credential.domain_name}\\${credential.username}` : credential.username
}

function sshCommand(machine, credential, command) {
  return new Promise((resolve, reject) => {
    const client = new SshClient()
    client.on('ready', () => client.exec(command, (error, stream) => {
      if (error) return reject(error)
      let stdout = ''; let stderr = ''
      stream.on('data', (chunk) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      stream.on('close', (code) => { client.end(); resolve({ code, stdout, stderr }) })
    })).on('error', reject).connect({ host: machine.fqdn || machine.ip_address, port: machine.port || 22, username: credential.username, password: decryptSecret(credential.secret_encrypted), readyTimeout: 20000 })
  })
}

function remotingCommand(machine, credential, command) {
  const encoded = Buffer.from(command, 'utf8').toString('base64')
  const shell = machine.os_family === 'windows'
    ? '$nativeOutput = & cmd.exe /d /c $command 2>&1'
    : "$env:TERM = 'dumb'; $nativeOutput = & bash -lc $command 2>&1"
  return executePsRemoting({ target: machine.fqdn || machine.ip_address, port: machine.port || 5985, username: usernameFor(credential), password: decryptSecret(credential.secret_encrypted), content: `$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ${shell}; $nativeOutput | ForEach-Object { Write-Output $_.ToString() }` })
}

function localCommand(command) {
  const encoded = Buffer.from(command, 'utf8').toString('base64')
  return executeLocalPowerShell(`$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $env:TERM = 'dumb'; $nativeOutput = & bash -lc $command 2>&1; $nativeOutput | ForEach-Object { Write-Output $_.ToString() }`)
}

export async function connectTerminal(machineId, requestedBy) {
  pruneRetainedSessions()
  const machine = get('SELECT * FROM machines WHERE id = ?', [machineId])
  if (!machine) throw new Error('Machine not found')
  if (machine.transport === 'local') {
    writeLog('info', 'terminal', 'CLI connection using local PowerShell host', { machineId, requestedBy })
    const result = cleanTerminalResult(await localCommand('echo POSHinit terminal ready'))
    const id = nanoid(); const session = { machine, credential: null, transport: 'local', requestedBy }; sessions.set(id, session); persistSession(id, session)
    recordOutput(id, 'stdout', result.stdout); return { id, transport: 'local', output: result.stdout, policy: policyForClient() }
  }
  const credential = credentialFor(machine)
  const probe = machine.os_family === 'windows' ? 'cmd.exe /c echo POSHinit terminal ready' : 'bash -lc "echo POSHinit terminal ready"'
  try {
    writeLog('info', 'terminal', 'CLI connection attempting PowerShell Remoting', { machineId, requestedBy })
    const result = cleanTerminalResult(await remotingCommand(machine, credential, probe))
    if (result.code !== 0) throw new Error(result.stderr || 'PowerShell Remoting probe failed')
    const id = nanoid(); const session = { machine, credential, transport: 'psremoting', requestedBy }; sessions.set(id, session); persistSession(id, session)
    writeLog('info', 'terminal', 'CLI connected through PowerShell Remoting', { machineId, sessionId: id, requestedBy })
    recordOutput(id, 'stdout', result.stdout); return { id, transport: 'psremoting', output: result.stdout, policy: policyForClient() }
  } catch (error) {
    writeLog('warning', 'terminal', 'PowerShell Remoting CLI connection failed', { machineId, requestedBy, reason: error.message })
    if (machine.os_family !== 'linux') throw new Error(`PowerShell Remoting failed: ${error.message}`)
    writeLog('info', 'terminal', 'CLI connection attempting SSH fallback', { machineId, requestedBy })
    const result = cleanTerminalResult(await sshCommand(machine, credential, 'TERM=dumb; echo POSHinit terminal ready'))
    if (result.code !== 0) throw new Error(result.stderr || 'SSH fallback probe failed')
    const id = nanoid(); const session = { machine, credential, transport: 'ssh', requestedBy }; sessions.set(id, session); persistSession(id, session)
    writeLog('info', 'terminal', 'CLI connected through SSH fallback', { machineId, sessionId: id, requestedBy })
    recordOutput(id, 'stdout', result.stdout); return { id, transport: 'ssh', output: result.stdout, policy: policyForClient() }
  }
}

export async function runTerminalCommand(sessionId, command) {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Terminal session expired. Connect again.')
  const safeCommand = String(command || '').trim()
  if (!safeCommand) return { code: 0, stdout: '', stderr: '' }
  try {
    recordEvent(sessionId, 'command', safeCommand)
    const result = cleanTerminalResult(session.transport === 'psremoting'
      ? await remotingCommand(session.machine, session.credential, safeCommand)
      : session.transport === 'local'
        ? await localCommand(safeCommand)
        : await sshCommand(session.machine, session.credential, `TERM=dumb; echo ${Buffer.from(safeCommand, 'utf8').toString('base64')} | base64 -d | bash`))
    writeLog('info', 'terminal', 'CLI command completed', { machineId: session.machine.id, sessionId, code: result.code })
    recordOutput(sessionId, 'stdout', result.stdout); recordOutput(sessionId, 'stderr', result.stderr); return result
  } catch (error) {
    writeLog('error', 'terminal', 'CLI command failed', { machineId: session.machine.id, sessionId, reason: error.message })
    return { code: 1, stdout: '', stderr: error.message }
  }
}

export function streamTerminalCommand(sessionId, command, emit) {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Terminal session expired. Connect again.')
  const safeCommand = String(command || '').trim()
  if (!safeCommand) { emit({ type: 'complete', code: 0 }); return () => {} }
  if (session.activeCommand) throw new Error('A terminal command is already running')
  recordEvent(sessionId, 'command', safeCommand)
  const finish = (code) => { if (!session.activeCommand) return; session.activeCommand = null; recordEvent(sessionId, 'complete', '', { code }); writeLog('info', 'terminal', 'CLI command completed', { machineId: session.machine.id, sessionId, code }); emit({ type: 'complete', code }) }
  const fail = (error) => { if (!session.activeCommand) return; session.activeCommand = null; emit({ type: 'stderr', data: error.message }); emit({ type: 'complete', code: 1 }) }
  const output = (type, data) => { recordOutput(sessionId, type, cleanTerminalOutput(data)); emit({ type, data: cleanTerminalOutput(data) }) }
  if (session.transport === 'ssh') {
    const client = new SshClient(); session.activeCommand = { cancel: () => client.end() }
    client.on('ready', () => client.exec(`TERM=dumb; echo ${Buffer.from(safeCommand, 'utf8').toString('base64')} | base64 -d | bash`, (error, stream) => { if (error) return fail(error); stream.on('data', (chunk) => output('stdout', chunk)); stream.stderr.on('data', (chunk) => output('stderr', chunk)); stream.on('close', finish) })).on('error', fail).connect({ host: session.machine.fqdn || session.machine.ip_address, port: session.machine.port || 22, username: usernameFor(session.credential), password: decryptSecret(session.credential.secret_encrypted), readyTimeout: 20000 })
  } else {
    const handlers = { onStdout: (data) => output('stdout', data), onStderr: (data) => output('stderr', data), onClose: finish, onError: fail }
    const child = session.transport === 'psremoting'
      ? streamPsRemoting({ target: session.machine.fqdn || session.machine.ip_address, port: session.machine.port || 5985, username: usernameFor(session.credential), password: decryptSecret(session.credential.secret_encrypted), content: `$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(safeCommand).toString('base64')}')); & ${session.machine.os_family === 'windows' ? 'cmd.exe /d /c' : 'bash -lc'} $command 2>&1 | ForEach-Object { Write-Output $_ }` }, handlers)
      : streamLocalPowerShell(`$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(safeCommand).toString('base64')}')); & bash -lc $command 2>&1 | ForEach-Object { Write-Output $_ }`, handlers)
    session.activeCommand = { cancel: () => child.kill('SIGTERM') }
  }
  return () => session.activeCommand?.cancel()
}

export function cancelTerminalCommand(sessionId) { const session = sessions.get(sessionId); if (!session?.activeCommand) return false; session.activeCommand.cancel(); writeLog('warning', 'terminal', 'CLI command cancelled', { machineId: session.machine.id, sessionId }); return true }

export function disconnectTerminal(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  session.activeCommand?.cancel()
  sessions.delete(sessionId)
  if (getRemoteSessionSettings().recordSessions) recordEvent(sessionId, 'disconnected')
  run("UPDATE remote_sessions SET status = 'disconnected', closed_at = ? WHERE id = ?", [nowIso(), sessionId])
  recordAudit({ actorId: session.requestedBy, action: 'remote_session.disconnected', resourceType: 'remote_session', resourceId: sessionId, context: { machineId: session.machine.id } })
  writeLog('info', 'terminal', 'CLI session disconnected', { machineId: session.machine.id, sessionId, requestedBy: session.requestedBy })
}

export function auditTerminalClipboard(sessionId, direction, length) { const session = sessions.get(sessionId); if (!session) throw new Error('Terminal session expired. Connect again.'); const policy = getRemoteSessionSettings(); if (!policy.allowClipboard) throw new Error('Clipboard is disabled by remote session policy'); recordEvent(sessionId, `clipboard_${direction}`, '', { length: Math.max(0, Number(length) || 0) }); recordAudit({ actorId: session.requestedBy, action: `remote_session.clipboard_${direction}`, resourceType: 'remote_session', resourceId: sessionId, context: { length: Math.max(0, Number(length) || 0) } }); return { accepted: true } }
export function terminalTransferGuard(sessionId, direction) { const session = sessions.get(sessionId); if (!session) throw new Error('Terminal session expired. Connect again.'); const policy = getRemoteSessionSettings(); const allowed = direction === 'upload' ? policy.allowUpload : policy.allowDownload; recordEvent(sessionId, `transfer_${direction}`, '', { allowed }); recordAudit({ actorId: session.requestedBy, action: `remote_session.transfer_${direction}`, resourceType: 'remote_session', resourceId: sessionId, outcome: allowed ? 'allowed' : 'denied', context: { policyEnforced: true } }); if (!allowed) { const error = new Error(`${direction === 'upload' ? 'Upload' : 'Download'} is disabled by remote session policy`); error.statusCode = 403; throw error } return { allowed, message: 'Transfer policy permits this operation; a brokered transfer provider is required to move files.' } }
export function listTerminalTranscript(sessionId) { pruneRetainedSessions(); return all('SELECT sequence,event_type,content,metadata_json,created_at FROM remote_session_events WHERE session_id = ? ORDER BY sequence', [sessionId]).map((row) => ({ ...row, metadata: JSON.parse(row.metadata_json || '{}') })) }
export function brokeredSessionLaunch(machineId, kind, requestedBy) { const machine = get('SELECT id,name,fqdn,ip_address FROM machines WHERE id = ?', [machineId]); if (!machine) throw new Error('Machine not found'); const policy = getRemoteSessionSettings(); const template = kind === 'rdp' ? policy.brokerRdpUrl : policy.brokerSshUrl; if (!template) throw new Error(`No brokered ${kind.toUpperCase()} integration is configured`); const target = encodeURIComponent(machine.fqdn || machine.ip_address || machine.name); const url = template.replaceAll('{{target}}', target).replaceAll('{{machineId}}', encodeURIComponent(machine.id)); recordAudit({ actorId: requestedBy, action: `remote_session.broker_${kind}`, resourceType: 'inventory', resourceId: machine.id, context: { brokered: true } }); return { url, kind, machineId: machine.id, credentialIncluded: false }
}
