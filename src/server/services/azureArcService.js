import { nanoid } from 'nanoid'
import { get } from '../db/client.js'
import { decryptSecret, encryptSecret } from '../utils/crypto.js'
import { saveGroup } from './groupService.js'
import { saveMachine } from './machineService.js'
import { getSettings, saveSettings } from './settingsService.js'

const armScope = 'https://management.azure.com//.default'
const hybridComputeApiVersion = '2025-01-13'

function required(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is required for Azure Arc discovery`)
  return normalized
}

export function normalizeAzureArcConnectors(settings = {}) {
  return Array.isArray(settings.connectors) ? settings.connectors : []
}

export function normalizeAzureArcMachine(machine = {}) {
  const properties = machine.properties || {}
  const resourceGroup = String(machine.id || '').match(/\/resourceGroups\/([^/]+)/i)?.[1] || ''
  const osName = [properties.osName, properties.osSku, properties.osEdition, properties.osVersion].filter(Boolean).join(' ')
  const osFamily = /windows/i.test(osName) ? 'windows' : 'linux'
  return {
    id: machine.id || machine.name,
    name: properties.displayName || machine.name || properties.machineFqdn || 'Azure Arc machine',
    fqdn: properties.dnsFqdn || properties.machineFqdn || machine.name || '',
    resourceGroup,
    location: machine.location || '',
    osFamily,
    osName: osName || 'Operating system not reported',
    status: properties.status || properties.provisioningState || 'Unknown',
    agentVersion: properties.agentVersion || '',
    tags: machine.tags || {},
  }
}

async function acquireArmToken(connector) {
  const body = new URLSearchParams({
    client_id: connector.clientId,
    client_secret: connector.clientSecretPlain,
    scope: armScope,
    grant_type: 'client_credentials',
  })
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(connector.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || `Azure token request failed with status ${response.status}`)
  return payload.access_token
}

async function listAllArcMachines(connector) {
  const token = await acquireArmToken(connector)
  let next = `https://management.azure.com/subscriptions/${encodeURIComponent(connector.subscriptionId)}/providers/Microsoft.HybridCompute/machines?api-version=${hybridComputeApiVersion}`
  const machines = []
  while (next) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error?.message || `Azure Arc inventory request failed with status ${response.status}`)
    machines.push(...(payload.value || []))
    next = payload.nextLink || ''
  }
  return machines.map(normalizeAzureArcMachine).filter((machine) => machine.id && machine.name)
}

function resolveConnector(settings, connectorId) {
  const saved = normalizeAzureArcConnectors(settings).find((connector) => connector.id === connectorId)
  if (!saved) throw new Error('Azure Arc connector was not found')
  return {
    ...saved,
    tenantId: required(saved.tenantId, 'Tenant ID'),
    clientId: required(saved.clientId, 'Client ID'),
    clientSecretPlain: required(decryptSecret(saved.clientSecretEncrypted), 'Client secret'),
    subscriptionId: required(saved.subscriptionId, 'Subscription ID'),
  }
}

function importMachines(connector, values, credentialIds = {}) {
  const imported = values.map((item) => {
    const sourceRef = `${connector.id}:${item.id}`
    const existing = get('SELECT id FROM machines WHERE source_type = ? AND source_ref = ?', ['azure_arc', sourceRef])
    return saveMachine({
      id: existing?.id,
      name: item.name,
      fqdn: item.fqdn,
      ipAddress: '',
      notes: `Imported from Azure Arc ${connector.name || connector.subscriptionId} · ${item.resourceGroup || 'resource group unavailable'} · ${item.location || 'region unavailable'} · ${item.status}`,
      osFamily: item.osFamily,
      transport: 'psremoting',
      port: 5985,
      credentialId: credentialIds[item.id] || null,
      sourceType: 'azure_arc',
      sourceRef,
    })
  })
  if (connector.autoImportGroupId) {
    saveGroup({
      id: connector.autoImportGroupId,
      name: connector.autoImportGroupName || `Imported ${connector.name || 'Azure Arc'} Nodes`,
      description: `Machines imported from Azure Arc subscription ${connector.subscriptionId}.`,
      machineIds: imported.map((machine) => machine.id),
    })
  }
  return imported
}

export async function discoverAzureArcMachines(settings, connectorId) {
  return listAllArcMachines(resolveConnector(settings, connectorId))
}

export async function importAzureArcSelection(settings, connectorId, machineIds, credentialIds) {
  const connector = resolveConnector(settings, connectorId)
  const selected = new Set(machineIds || [])
  const values = (await listAllArcMachines(connector)).filter((machine) => selected.has(machine.id))
  return importMachines(connector, values, credentialIds)
}

export function saveAzureArcSettings(payload = {}) {
  const existing = normalizeAzureArcConnectors(getSettings().azureArc)
  const connectors = (payload.connectors || []).map((raw) => {
    const prior = existing.find((connector) => connector.id === raw.id)
    const secret = String(raw.clientSecret || '').trim()
    return {
      id: raw.id || nanoid(),
      name: String(raw.name || 'Azure Arc').trim(),
      tenantId: String(raw.tenantId || '').trim(),
      clientId: String(raw.clientId || '').trim(),
      subscriptionId: String(raw.subscriptionId || '').trim(),
      clientSecretEncrypted: secret ? encryptSecret(secret) : raw.clientSecretEncrypted || prior?.clientSecretEncrypted || '',
      autoImportGroupId: raw.autoImportGroupId || '',
      autoImportGroupName: raw.autoImportGroupName || '',
    }
  })
  const saved = saveSettings('azureArc', { connectors })
  return {
    ...saved,
    connectors: connectors.map(({ clientSecretEncrypted, ...connector }) => ({
      ...connector,
      clientSecretConfigured: Boolean(clientSecretEncrypted && decryptSecret(clientSecretEncrypted)),
    })),
  }
}
