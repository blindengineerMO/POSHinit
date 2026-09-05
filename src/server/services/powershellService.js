import { spawn } from 'node:child_process'
import process from 'node:process'

function runPwsh(args, content) {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', args, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })

    child.stdin.write(content)
    child.stdin.end()
  })
}

export function streamPwsh(args, content, { onStdout, onStderr, onClose, onError } = {}) {
  const child = spawn('pwsh', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => onStdout?.(chunk.toString()))
  child.stderr.on('data', (chunk) => onStderr?.(chunk.toString()))
  child.on('error', (error) => onError?.(error))
  child.on('close', (code) => onClose?.(code))
  child.stdin.write(content)
  child.stdin.end()
  return child
}

function toBase64(value) {
  return Buffer.from(String(value ?? ''), 'utf8').toString('base64')
}

export function buildPsRemotingScript({ target, port = 5985, username, password, content }) {
  const encoded = {
    target: toBase64(target),
    username: toBase64(username),
    password: toBase64(password),
    content: toBase64(content),
  }
  const useSsl = Number(port) === 5986 ? '$true' : '$false'

  // Send all sensitive values on stdin, not as child-process arguments.
  return `
$ErrorActionPreference = 'Stop'
function Read-PoshinitValue([string]$Value) {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}
$target = Read-PoshinitValue '${encoded.target}'
$username = Read-PoshinitValue '${encoded.username}'
$password = Read-PoshinitValue '${encoded.password}'
$scriptContent = Read-PoshinitValue '${encoded.content}'
$securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
$credential = [PSCredential]::new($username, $securePassword)
$invokeParameters = @{
  ComputerName = $target
  Port = ${Number(port) || 5985}
  Credential = $credential
  ScriptBlock = [ScriptBlock]::Create($scriptContent)
  ErrorAction = 'Stop'
}
if (${useSsl}) { $invokeParameters.UseSSL = $true }
# Force remoting objects and native shell output into one concrete stdout stream.
$remoteOutput = Invoke-Command @invokeParameters 2>&1 | Out-String -Width 4096
Write-Output $remoteOutput
`
}

export async function validatePowerShell(content) {
  const wrapped = `
$errors = $null
[System.Management.Automation.Language.Parser]::ParseInput(@'
${content}
'@, [ref]$null, [ref]$errors) | Out-Null
$errors | Select-Object Message, Extent | ConvertTo-Json -Depth 4
`

  const result = await runPwsh(['-NoProfile', '-Command', '-'], wrapped)
  const raw = result.stdout?.trim()
  const parsed = raw ? JSON.parse(raw) : []
  const errors = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []

  return {
    ok: errors.length === 0,
    errors,
    stderr: result.stderr,
  }
}

export async function executeLocalPowerShell(content) {
  return runPwsh(['-NoProfile', '-Command', '-'], content)
}

export async function executePsRemoting({ target, port, username, password, content }) {
  return runPwsh(
    ['-NoProfile', '-NonInteractive', '-Command', '-'],
    buildPsRemotingScript({ target, port, username, password, content }),
  )
}

export function streamLocalPowerShell(content, handlers) { return streamPwsh(['-NoProfile', '-Command', '-'], content, handlers) }
export function streamPsRemoting(options, handlers) { return streamPwsh(['-NoProfile', '-NonInteractive', '-Command', '-'], buildPsRemotingScript(options), handlers) }
