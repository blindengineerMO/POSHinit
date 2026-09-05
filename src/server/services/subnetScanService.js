import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { reverse } from 'node:dns/promises'
import process from 'node:process'
import { nanoid } from 'nanoid'
import { get } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'
import { saveMachine } from './machineService.js'
import { executePsRemoting } from './powershellService.js'
import { Client as SshClient } from 'ssh2'

const execFileAsync = promisify(execFile)
const sessions = new Map()
const maxHosts = 1024

function ipv4ToInteger(address) {
  const octets = String(address || '').trim().split('.')
  if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet) || Number(octet) > 255)) throw new Error('Enter a valid IPv4 CIDR, such as 10.20.30.0/24')
  return octets.reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0
}

function integerToIpv4(value) { return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.') }

export function expandIpv4Cidr(value) {
  const [address, prefixRaw] = String(value || '').trim().split('/')
  const prefix = Number(prefixRaw)
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) throw new Error('Use an IPv4 subnet between /8 and /30')
  const base = ipv4ToInteger(address)
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  const network = base & mask
  const count = (2 ** (32 - prefix)) - 2
  if (count > maxHosts) throw new Error(`Subnet contains ${count.toLocaleString()} hosts; limit scans to ${maxHosts.toLocaleString()} hosts or fewer`)
  return Array.from({ length: count }, (_, index) => integerToIpv4(network + index + 1))
}

async function ping(address) {
  const args = process.platform === 'win32' ? ['-n', '1', '-w', '1000', address] : ['-c', '1', '-W', '1', address]
  try {
    await execFileAsync('ping', args, { timeout: 2000, windowsHide: true })
    return true
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('The POSHinit server does not have a ping executable available for subnet discovery')
    return false
  }
}

function credentialUsername(credential) {
  return credential.domain_name && !credential.username.includes('\\') && !credential.username.includes('@')
    ? `${credential.domain_name}\\${credential.username}`
    : credential.username
}

function sshProbe(address, credential) {
  return new Promise((resolve) => {
    const client = new SshClient()
    const finish = (result) => { client.end(); resolve(result) }
    client.on('ready', () => client.exec('echo POSHinit subnet discovery', (error, stream) => {
      if (error) return finish({ ok: false, detail: error.message })
      let output = ''
      stream.on('data', (chunk) => { output += chunk.toString() })
      stream.stderr.on('data', (chunk) => { output += chunk.toString() })
      stream.on('close', (code) => finish({ ok: code === 0, detail: output.trim() || `SSH exited ${code}` }))
    }))
    client.on('error', (error) => finish({ ok: false, detail: error.message }))
    client.connect({ host: address, port: 22, username: credential.username, password: decryptSecret(credential.secret_encrypted), readyTimeout: 5000 })
  })
}

async function testConnection(address, credential) {
  try {
    if (credential.protocol === 'ssh') return sshProbe(address, credential)
    const result = await executePsRemoting({ target: address, port: 5985, username: credentialUsername(credential), password: decryptSecret(credential.secret_encrypted), content: "Write-Output ('POSHinit connected to ' + $env:COMPUTERNAME)" })
    return { ok: result.code === 0, detail: `${result.stdout || ''}${result.stderr || ''}`.trim() || (result.code === 0 ? 'PowerShell Remoting connected.' : 'PowerShell Remoting failed.') }
  } catch (error) { return { ok: false, detail: error.message } }
}

function snapshot(session) {
  return {
    id: session.id,
    cidr: session.cidr,
    status: session.status,
    stage: session.stage,
    transport: session.transport,
    total: session.addresses.length,
    completed: session.completed,
    reachable: session.results.filter((item) => item.reachable).length,
    connected: session.results.filter((item) => item.connectionOk).length,
    results: session.results,
    error: session.error || '',
  }
}

async function eachLimited(values, limit, action) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      await action(values[index], index)
    }
  }))
}

async function runScan(session, credential) {
  try {
    session.stage = 'Pinging addresses'
    await eachLimited(session.addresses, 32, async (address) => {
      const reachable = await ping(address)
      if (reachable) session.results.push({ address, reachable: true, hostname: '', connectionOk: false, connectionDetail: 'Waiting for DNS and connection test' })
      session.completed += 1
    })
    session.stage = 'Resolving discovered addresses'
    await eachLimited(session.results, 16, async (result) => {
      result.hostname = (await reverse(result.address).catch(() => []))[0] || ''
    })
    session.stage = `Testing ${credential.protocol === 'ssh' ? 'SSH' : 'PowerShell Remoting'} access`
    await eachLimited(session.results, 4, async (result) => {
      const connection = await testConnection(result.address, credential)
      result.connectionOk = connection.ok
      result.connectionDetail = connection.detail
    })
    session.stage = 'Scan complete'
    session.status = 'complete'
  } catch (error) {
    session.error = error.message
    session.status = 'failed'
    session.stage = 'Scan failed'
  }
}

export function startSubnetScan({ cidr, credentialId }) {
  const addresses = expandIpv4Cidr(cidr)
  const credential = get('SELECT * FROM credentials WHERE id = ?', [credentialId])
  if (!credential || credential.secret_type === 'token') throw new Error('Choose a username/password credential from Secret Vault')
  if (!['psremoting', 'ssh'].includes(credential.protocol)) throw new Error('The selected credential must use PowerShell Remoting or SSH')
  const session = { id: nanoid(), cidr: String(cidr).trim(), credentialId, transport: credential.protocol, addresses, status: 'running', stage: 'Preparing scan', completed: 0, results: [], error: '' }
  sessions.set(session.id, session)
  void runScan(session, credential)
  return snapshot(session)
}

export function getSubnetScan(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Subnet scan session was not found or has expired')
  return snapshot(session)
}

export function importSubnetScan(sessionId, machines = []) {
  const session = sessions.get(sessionId)
  if (!session || session.status !== 'complete') throw new Error('Complete the subnet scan before importing machines')
  const connected = new Map(session.results.filter((result) => result.connectionOk).map((result) => [result.address, result]))
  const imported = (machines || []).flatMap((machine) => {
    const result = connected.get(machine.address)
    if (!result || !['windows', 'linux'].includes(machine.osFamily)) return []
    return [saveMachine({ name: result.hostname || result.address, fqdn: result.hostname || result.address, ipAddress: result.address, notes: `Imported from subnet scan ${session.cidr}; ${result.connectionDetail}`, osFamily: machine.osFamily, transport: get('SELECT protocol FROM credentials WHERE id = ?', [session.credentialId])?.protocol || 'psremoting', port: machine.osFamily === 'linux' ? 22 : 5985, credentialId: session.credentialId, sourceType: 'subnet_scan', sourceRef: `${session.id}:${result.address}` })]
  })
  sessions.delete(sessionId)
  return imported
}
