import { Client as SshClient } from 'ssh2'
import { nanoid } from 'nanoid'
import { get } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'
import { executeLocalPowerShell, executePsRemoting, streamLocalPowerShell, streamPsRemoting } from './powershellService.js'
import { writeLog } from './logService.js'

const sessions = new Map()

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
  const machine = get('SELECT * FROM machines WHERE id = ?', [machineId])
  if (!machine) throw new Error('Machine not found')
  if (machine.transport === 'local') {
    writeLog('info', 'terminal', 'CLI connection using local PowerShell host', { machineId, requestedBy })
    const result = cleanTerminalResult(await localCommand('echo POSHinit terminal ready'))
    const id = nanoid(); sessions.set(id, { machine, credential: null, transport: 'local', requestedBy })
    return { id, transport: 'local', output: result.stdout }
  }
  const credential = credentialFor(machine)
  const probe = machine.os_family === 'windows' ? 'cmd.exe /c echo POSHinit terminal ready' : 'bash -lc "echo POSHinit terminal ready"'
  try {
    writeLog('info', 'terminal', 'CLI connection attempting PowerShell Remoting', { machineId, requestedBy })
    const result = cleanTerminalResult(await remotingCommand(machine, credential, probe))
    if (result.code !== 0) throw new Error(result.stderr || 'PowerShell Remoting probe failed')
    const id = nanoid(); sessions.set(id, { machine, credential, transport: 'psremoting', requestedBy })
    writeLog('info', 'terminal', 'CLI connected through PowerShell Remoting', { machineId, sessionId: id, requestedBy })
    return { id, transport: 'psremoting', output: result.stdout }
  } catch (error) {
    writeLog('warning', 'terminal', 'PowerShell Remoting CLI connection failed', { machineId, requestedBy, reason: error.message })
    if (machine.os_family !== 'linux') throw new Error(`PowerShell Remoting failed: ${error.message}`)
    writeLog('info', 'terminal', 'CLI connection attempting SSH fallback', { machineId, requestedBy })
    const result = cleanTerminalResult(await sshCommand(machine, credential, 'TERM=dumb; echo POSHinit terminal ready'))
    if (result.code !== 0) throw new Error(result.stderr || 'SSH fallback probe failed')
    const id = nanoid(); sessions.set(id, { machine, credential, transport: 'ssh', requestedBy })
    writeLog('info', 'terminal', 'CLI connected through SSH fallback', { machineId, sessionId: id, requestedBy })
    return { id, transport: 'ssh', output: result.stdout }
  }
}

export async function runTerminalCommand(sessionId, command) {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Terminal session expired. Connect again.')
  const safeCommand = String(command || '').trim()
  if (!safeCommand) return { code: 0, stdout: '', stderr: '' }
  try {
    const result = cleanTerminalResult(session.transport === 'psremoting'
      ? await remotingCommand(session.machine, session.credential, safeCommand)
      : session.transport === 'local'
        ? await localCommand(safeCommand)
        : await sshCommand(session.machine, session.credential, `TERM=dumb; echo ${Buffer.from(safeCommand, 'utf8').toString('base64')} | base64 -d | bash`))
    writeLog('info', 'terminal', 'CLI command completed', { machineId: session.machine.id, sessionId, code: result.code })
    return result
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
  const finish = (code) => { if (!session.activeCommand) return; session.activeCommand = null; writeLog('info', 'terminal', 'CLI command completed', { machineId: session.machine.id, sessionId, code }); emit({ type: 'complete', code }) }
  const fail = (error) => { if (!session.activeCommand) return; session.activeCommand = null; emit({ type: 'stderr', data: error.message }); emit({ type: 'complete', code: 1 }) }
  if (session.transport === 'ssh') {
    const client = new SshClient(); session.activeCommand = { cancel: () => client.end() }
    client.on('ready', () => client.exec(`TERM=dumb; echo ${Buffer.from(safeCommand, 'utf8').toString('base64')} | base64 -d | bash`, (error, stream) => { if (error) return fail(error); stream.on('data', (chunk) => emit({ type: 'stdout', data: cleanTerminalOutput(chunk) })); stream.stderr.on('data', (chunk) => emit({ type: 'stderr', data: cleanTerminalOutput(chunk) })); stream.on('close', finish) })).on('error', fail).connect({ host: session.machine.fqdn || session.machine.ip_address, port: session.machine.port || 22, username: usernameFor(session.credential), password: decryptSecret(session.credential.secret_encrypted), readyTimeout: 20000 })
  } else {
    const handlers = { onStdout: (data) => emit({ type: 'stdout', data: cleanTerminalOutput(data) }), onStderr: (data) => emit({ type: 'stderr', data: cleanTerminalOutput(data) }), onClose: finish, onError: fail }
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
  writeLog('info', 'terminal', 'CLI session disconnected', { machineId: session.machine.id, sessionId, requestedBy: session.requestedBy })
}
