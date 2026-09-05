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
        username: credential.username,
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
    const credential = getMachineCredential(machine)
    if (!credential) {
      throw new Error('Machine is missing a PowerShell remoting credential')
    }
    if (credential.protocol !== 'psremoting') {
      throw new Error('Machine requires a credential configured for PowerShell remoting')
    }

    result = await executePsRemoting({
      target: machine.fqdn || machine.ip_address,
      port: machine.port || 5985,
      username: remoteUsername(credential),
      password: decryptSecret(credential.secret_encrypted),
      content: "Write-Output ('PowerShell remoting connected to ' + $env:COMPUTERNAME)",
    })
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

  return {
    ok: result.code === 0,
    ...result,
  }
}

export function saveCredential(payload, ownerUserId) {
  const credentialId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id
    ? get('SELECT created_at FROM credentials WHERE id = ?', [payload.id])
    : null

  run(
    `INSERT INTO credentials (
       id, name, scope, owner_user_id, team_ids_json, username, domain_name, protocol, secret_encrypted,
       notes, created_at, updated_at
     ) VALUES (
       @id, @name, @scope, @ownerUserId, @teamIdsJson, @username, @domainName, @protocol, @secretEncrypted,
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
       secret_encrypted = excluded.secret_encrypted,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    {
      id: credentialId,
      name: payload.name,
      scope: payload.scope || 'personal',
      ownerUserId,
      teamIdsJson: JSON.stringify(payload.teamIds || []),
      username: payload.username,
      domainName: payload.domainName || '',
      protocol: payload.protocol || 'ssh',
      secretEncrypted: payload.secretEncrypted,
      notes: payload.notes || '',
      createdAt: existing?.created_at || timestamp,
      updatedAt: timestamp,
    },
  )

  return get(
    `SELECT id, name, scope, owner_user_id, team_ids_json, username, domain_name, protocol,
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
