import fs from 'node:fs'
import { Client as SshClient } from 'ssh2'
import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'
import { executeLocalPowerShell, executePsRemoting } from './powershellService.js'

const supportedTransports = new Set(['local', 'ssh', 'psremoting'])

export function listMachines() {
  return all(
    `SELECT id, name, fqdn, ip_address, notes, os_family, transport, port, credential_id, source_type,
            source_ref, last_tested_at, last_test_status, last_test_output, created_at, updated_at
     FROM machines
     ORDER BY name ASC`,
  )
}

export function saveMachine(payload) {
  const transport = payload.transport || 'local'
  if (!supportedTransports.has(transport)) {
    throw new Error(`Unsupported transport: ${transport}`)
  }

  if (payload.credentialId) {
    const credential = get('SELECT secret_type FROM credentials WHERE id = ?', [payload.credentialId])
    if (!credential) throw new Error('Selected credential was not found')
    if (credential.secret_type === 'token') throw new Error('Token secrets are for script injection and cannot be assigned to a machine')
  }

  const machineId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id ? get('SELECT created_at FROM machines WHERE id = ?', [payload.id]) : null

  run(
    `INSERT INTO machines (
       id, name, fqdn, ip_address, notes, os_family, transport, port, credential_id,
       source_type, source_ref, created_at, updated_at
     ) VALUES (
       @id, @name, @fqdn, @ipAddress, @notes, @osFamily, @transport, @port, @credentialId,
       @sourceType, @sourceRef, @createdAt, @updatedAt
     )
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       fqdn = excluded.fqdn,
       ip_address = excluded.ip_address,
       notes = excluded.notes,
       os_family = excluded.os_family,
       transport = excluded.transport,
       port = excluded.port,
       credential_id = excluded.credential_id,
       source_type = excluded.source_type,
       source_ref = excluded.source_ref,
       updated_at = excluded.updated_at`,
    {
      id: machineId,
      name: payload.name,
      fqdn: payload.fqdn || '',
      ipAddress: payload.ipAddress || '',
      notes: payload.notes || '',
      osFamily: payload.osFamily || 'linux',
      transport,
      port: Number(payload.port || (transport === 'psremoting' ? 5985 : 22)),
      credentialId: payload.credentialId || null,
      sourceType: payload.sourceType || 'manual',
      sourceRef: payload.sourceRef || '',
      createdAt: existing?.created_at || timestamp,
      updatedAt: timestamp,
    },
  )

  return get('SELECT * FROM machines WHERE id = ?', [machineId])
}

function getMachineCredential(machine) {
  if (!machine.credential_id) {
    return null
  }

  return get('SELECT * FROM credentials WHERE id = ?', [machine.credential_id])
}

function remoteUsername(credential) {
  if (!credential.domain_name || credential.username.includes('\\') || credential.username.includes('@')) {
    return credential.username
  }

  return `${credential.domain_name}\\${credential.username}`
}

function getPsRemotingCredential(credentialId) {
  const credential = credentialId ? get('SELECT * FROM credentials WHERE id = ?', [credentialId]) : null
  if (!credential) throw new Error('A PowerShell remoting credential is required')
  if (credential.protocol !== 'psremoting') throw new Error('The selected credential must be configured for PowerShell remoting')
  return credential
}

async function probePsRemoting(target, port, credentialId) {
  if (!String(target || '').trim()) throw new Error('The virtual machine did not report a reachable name or IP address')
  const credential = getPsRemotingCredential(credentialId)
  const result = await executePsRemoting({
    target: String(target).trim(),
    port: Number(port || 5985),
    username: remoteUsername(credential),
    password: decryptSecret(credential.secret_encrypted),
    content: "Write-Output ('PowerShell remoting connected to ' + $env:COMPUTERNAME)",
  })
  return { ok: result.code === 0, ...result }
}

function runOverSsh(machine, credential, command) {
  return new Promise((resolve, reject) => {
    const client = new SshClient()
    client
      .on('ready', () => {
        client.exec(command, (error, stream) => {
          if (error) {
            client.end()
            reject(error)
            return
          }

          let stdout = ''
          let stderr = ''

          stream
            .on('close', (code) => {
              client.end()
              resolve({ code, stdout, stderr })
            })
            .on('data', (chunk) => {
              stdout += chunk.toString()
            })

          stream.stderr.on('data', (chunk) => {
            stderr += chunk.toString()
          })
        })
      })
      .on('error', reject)
      .connect({
        host: machine.fqdn || machine.ip_address,
        port: machine.port || 22,
        username: remoteUsername(credential),
        password: decryptSecret(credential.secret_encrypted),
        readyTimeout: 20000,
      })
  })
}

export async function testMachineConnection(machineId) {
  const machine = get('SELECT * FROM machines WHERE id = ?', [machineId])
  if (!machine) {
    throw new Error('Machine not found')
  }

  let result
  if (machine.transport === 'local') {
    result = await executeLocalPowerShell("Write-Output 'Hello from local POSHinit node'")
  } else if (machine.transport === 'psremoting') {
    result = await probePsRemoting(machine.fqdn || machine.ip_address, machine.port, machine.credential_id)
  } else if (machine.transport === 'ssh') {
    const credential = getMachineCredential(machine)
    if (!credential) {
      throw new Error('Machine is missing an SSH credential')
    }

    result = await runOverSsh(
      machine,
      credential,
      "pwsh -NoProfile -Command \"Write-Output 'Hello from remote node'\"",
    )
  } else {
    throw new Error(`Unsupported transport: ${machine.transport}`)
  }

  run(
    `UPDATE machines
     SET last_tested_at = @testedAt, last_test_status = @status, last_test_output = @output
     WHERE id = @id`,
    {
      id: machineId,
      testedAt: nowIso(),
      status: result.code === 0 ? 'success' : 'failed',
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    },
  )

  return { ok: result.ok ?? result.code === 0, ...result }
}

export async function testMachineCandidate(payload = {}) {
  const target = String(payload.target || '').trim()
  let initial
  try {
    initial = await probePsRemoting(target, payload.port, payload.credentialId)
  } catch (error) {
    initial = { ok: false, code: 1, stdout: '', stderr: error.message }
  }
  if (initial.ok) return initial

  const credential = getPsRemotingCredential(payload.credentialId)
  try {
    const remediation = await runOverSsh(
      { fqdn: target, port: payload.sshPort || 22 },
      credential,
      'powershell.exe -NoProfile -NonInteractive -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck" || pwsh -NoProfile -NonInteractive -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck"',
    )
    if (remediation.code !== 0) {
      return { ...initial, remediationAttempted: true, remediationError: `${remediation.stdout || ''}${remediation.stderr || ''}`.trim() || 'SSH could not enable PowerShell remoting' }
    }
    try {
      const retried = await probePsRemoting(target, payload.port, payload.credentialId)
      return { ...retried, remediationAttempted: true, remediated: retried.ok, remediationError: retried.ok ? '' : 'PowerShell remoting remained unavailable after SSH remediation' }
    } catch (error) {
      return { ...initial, remediationAttempted: true, remediationError: `SSH remediation completed, but the remoting retry failed: ${error.message}` }
    }
  } catch (error) {
    return { ...initial, remediationAttempted: true, remediationError: `SSH remediation was unavailable: ${error.message}` }
  }
}

export function saveCredential(payload, ownerUserId) {
  const credentialId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id
    ? get('SELECT created_at FROM credentials WHERE id = ?', [payload.id])
    : null

  const secretType = payload.secretType || 'username_password'
  if (!['username_password', 'domain_password', 'token'].includes(secretType)) throw new Error('Unsupported secret type')
  if (secretType !== 'token' && !payload.username) throw new Error('Username is required for this secret type')
  if (secretType === 'domain_password' && !payload.domainName) throw new Error('Domain is required for a domain credential')
  if (!payload.secretEncrypted) throw new Error('A password or token is required')

  run(
    `INSERT INTO credentials (
       id, name, scope, owner_user_id, team_ids_json, username, domain_name, protocol, secret_type, secret_encrypted,
       notes, created_at, updated_at
     ) VALUES (
       @id, @name, @scope, @ownerUserId, @teamIdsJson, @username, @domainName, @protocol, @secretType, @secretEncrypted,
       @notes, @createdAt, @updatedAt
     )
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       scope = excluded.scope,
       owner_user_id = excluded.owner_user_id,
       team_ids_json = excluded.team_ids_json,
       username = excluded.username,
       domain_name = excluded.domain_name,
       protocol = excluded.protocol,
       secret_type = excluded.secret_type,
       secret_encrypted = excluded.secret_encrypted,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    {
      id: credentialId,
      name: payload.name,
      scope: payload.scope || 'personal',
      ownerUserId: ownerUserId || null,
      teamIdsJson: JSON.stringify(payload.teamIds || []),
      username: secretType === 'token' ? '' : payload.username,
      domainName: secretType === 'domain_password' ? payload.domainName : '',
      protocol: secretType === 'token' ? 'token' : payload.protocol || 'ssh',
      secretType,
      secretEncrypted: payload.secretEncrypted,
      notes: payload.notes || '',
      createdAt: existing?.created_at || timestamp,
      updatedAt: timestamp,
    },
  )

  return get(
    `SELECT id, name, scope, owner_user_id, team_ids_json, username, domain_name, protocol, secret_type,
            notes, created_at, updated_at
     FROM credentials
     WHERE id = ?`,
    [credentialId],
  )
}

export function uploadAsset(file) {
  return {
    name: file.originalname,
    relativePath: `data/uploads/${file.filename}`,
    size: fs.statSync(file.path).size,
  }
}
