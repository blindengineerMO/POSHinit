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
