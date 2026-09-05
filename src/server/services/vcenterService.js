import { nanoid } from 'nanoid'
import { get } from '../db/client.js'
import { decryptSecret, encryptSecret } from '../utils/crypto.js'
import { saveGroup } from './groupService.js'
import { saveMachine } from './machineService.js'
import { getSettings, saveSettings } from './settingsService.js'

function xmlEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function xmlDecode(value = '') {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&').trim()
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '')
  return raw && (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
}

function getSetCookie(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean)
  return values.map((value) => value.split(';', 1)[0]).join('; ')
}

function soapEnvelope(action, body) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:vim25"><soapenv:Body><${action}>${body}</${action}></soapenv:Body></soapenv:Envelope>`
}

function getSoapFault(xml) {
  const fault = xml.match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i) || xml.match(/<(?:\w+:)?localizedMessage[^>]*>([\s\S]*?)<\/(?:\w+:)?localizedMessage>/i)
  return fault ? xmlDecode(fault[1]) : ''
}

function readReference(xml, name) {
  const match = xml.match(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return match ? { type: match[1].match(/type="([^"]+)"/)?.[1] || '', value: xmlDecode(match[2]) } : null
}

function readProperty(block, name) {
  const property = block.match(new RegExp(`<propSet>[\\s\\S]*?<name>${name.replaceAll('.', '\\.')}</name>[\\s\\S]*?<val[^>]*>([\\s\\S]*?)<\\/val>[\\s\\S]*?<\\/propSet>`, 'i'))
  return property ? xmlDecode(property[1].replace(/<[^>]+>/g, '')) : ''
}

export function parseSoapInventory(xml) {
  return [...xml.matchAll(/<objects>([\s\S]*?)<\/objects>/gi)].map((match) => {
    const block = match[1]
    const reference = readReference(block, 'obj')
    return { id: reference?.value || '', name: readProperty(block, 'name'), guestOs: readProperty(block, 'guest.guestFullName'), ipAddress: readProperty(block, 'guest.ipAddress'), powerState: readProperty(block, 'runtime.powerState') }
  }).filter((machine) => machine.id && machine.name)
}

function readToken(xml) {
  const match = xml.match(/<token[^>]*>([\s\S]*?)<\/token>/i)
  return match ? xmlDecode(match[1]) : ''
}

async function postSoap(baseUrl, action, body, cookie = '') {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/sdk`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `\"urn:vim25/${action}\"`, ...(cookie ? { Cookie: cookie } : {}) },
    body: soapEnvelope(action, body),
  })
  const xml = await response.text()
  const fault = getSoapFault(xml)
  if (!response.ok || fault) throw new Error(fault || `VMware SOAP ${action} failed with status ${response.status}`)
  return { xml, cookie: getSetCookie(response) || cookie }
}

async function importStandaloneHostMachines(connector) {
  const baseUrl = normalizeBaseUrl(connector.baseUrl)
  const content = await postSoap(baseUrl, 'RetrieveServiceContent', '<_this type="ServiceInstance">ServiceInstance</_this>')
  const sessionManager = readReference(content.xml, 'sessionManager')
  const propertyCollector = readReference(content.xml, 'propertyCollector')
  const rootFolder = readReference(content.xml, 'rootFolder')
  const viewManager = readReference(content.xml, 'viewManager')
  if (!sessionManager || !propertyCollector || !rootFolder || !viewManager) throw new Error('Standalone host did not return the VMware SOAP service inventory')

  const login = await postSoap(baseUrl, 'Login', `<_this type="${xmlEscape(sessionManager.type)}">${xmlEscape(sessionManager.value)}</_this><userName>${xmlEscape(connector.username)}</userName><password>${xmlEscape(connector.passwordPlain)}</password>`, content.cookie)
  let cookie = login.cookie
  let view = null
  try {
    const viewResponse = await postSoap(baseUrl, 'CreateContainerView', `<_this type="${xmlEscape(viewManager.type)}">${xmlEscape(viewManager.value)}</_this><container type="${xmlEscape(rootFolder.type)}">${xmlEscape(rootFolder.value)}</container><type>VirtualMachine</type><recursive>true</recursive>`, cookie)
    cookie = viewResponse.cookie
    view = readReference(viewResponse.xml, 'returnval')
    if (!view) throw new Error('Standalone host did not create a VM container view')

    const properties = '<propSet><type>VirtualMachine</type><pathSet>name</pathSet><pathSet>guest.guestFullName</pathSet><pathSet>guest.ipAddress</pathSet><pathSet>runtime.powerState</pathSet></propSet>'
    const traversal = `<objectSet><obj type="${xmlEscape(view.type)}">${xmlEscape(view.value)}</obj><skip>true</skip><selectSet xsi:type="TraversalSpec"><name>viewTraversal</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet></objectSet>`
    let response = await postSoap(baseUrl, 'RetrievePropertiesEx', `<_this type="${xmlEscape(propertyCollector.type)}">${xmlEscape(propertyCollector.value)}</_this><specSet>${properties}${traversal}</specSet><options><maxObjects>1000</maxObjects></options>`, cookie)
    cookie = response.cookie
    const machines = parseSoapInventory(response.xml)
    let token = readToken(response.xml)
    while (token) {
      response = await postSoap(baseUrl, 'ContinueRetrievePropertiesEx', `<_this type="${xmlEscape(propertyCollector.type)}">${xmlEscape(propertyCollector.value)}</_this><token>${xmlEscape(token)}</token>`, cookie)
      cookie = response.cookie
      machines.push(...parseSoapInventory(response.xml))
      token = readToken(response.xml)
    }
    return machines
  } finally {
    if (view) await postSoap(baseUrl, 'DestroyView', `<_this type="${xmlEscape(view.type)}">${xmlEscape(view.value)}</_this>`, cookie).catch(() => {})
    await postSoap(baseUrl, 'Logout', `<_this type="${xmlEscape(sessionManager.type)}">${xmlEscape(sessionManager.value)}</_this>`, cookie).catch(() => {})
  }
}

async function createVcenterSession(baseUrl, username, password) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/session`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } })
  if (!response.ok) throw new Error(`vCenter session failed with status ${response.status}`)
  return response.text()
}

async function importVcenterInventory(connector) {
  const sessionId = await createVcenterSession(connector.baseUrl, connector.username, connector.passwordPlain)
  const response = await fetch(`${normalizeBaseUrl(connector.baseUrl)}/api/vcenter/vm`, { headers: { 'vmware-api-session-id': sessionId } })
  if (!response.ok) throw new Error(`Failed to fetch virtual machines from vCenter: ${response.status}`)
  const payload = await response.json()
  return (payload.value || payload || []).map((item) => ({ id: item.vm || item.name, name: item.name || item.vm || 'Imported VM', guestOs: item.guest_OS || '', ipAddress: '', powerState: item.power_state || '' }))
}

function importMachines(connector, values, credentialIds = {}) {
  const sourceType = connector.kind === 'esxi-host' ? 'esxi' : 'vcenter'
  const imported = values.map((item) => {
    const sourceRef = `${connector.id}:${item.id}`
    const existing = get('SELECT id FROM machines WHERE source_type = ? AND source_ref = ?', [sourceType, sourceRef])
    return saveMachine({ id: existing?.id, name: item.name, fqdn: item.name, ipAddress: item.ipAddress || '', notes: `Imported from ${connector.kind === 'esxi-host' ? 'standalone ESXi host' : 'vCenter'} ${normalizeBaseUrl(connector.baseUrl)}${item.powerState ? ` (${item.powerState})` : ''}`, osFamily: /windows/i.test(item.guestOs) ? 'windows' : 'linux', transport: 'psremoting', port: 5985, credentialId: credentialIds[item.id] || null, sourceType, sourceRef })
  })
  if (connector.autoImportGroupId) saveGroup({ id: connector.autoImportGroupId, name: connector.autoImportGroupName || `Imported ${connector.name || 'VMware'} Nodes`, description: `Machines imported from ${connector.name || normalizeBaseUrl(connector.baseUrl)}.`, machineIds: imported.map((machine) => machine.id) })
  return imported
}

export function normalizeVmwareConnectors(settings = {}) {
  if (Array.isArray(settings.connectors)) return settings.connectors
  if (!settings.baseUrl) return []
  return [{ id: 'legacy-vcenter', kind: 'vcenter', name: 'vCenter', baseUrl: settings.baseUrl, username: settings.username || '', passwordEncrypted: settings.passwordEncrypted || '', verifyTls: Boolean(settings.verifyTls), autoImportGroupId: settings.autoImportGroupId || '' }]
}

function resolveConnector(settings, connectorId) {
  const savedConnector = normalizeVmwareConnectors(settings).find((item) => item.id === connectorId)
  const connector = savedConnector && {
    ...savedConnector,
    passwordPlain: savedConnector.passwordPlain || decryptSecret(savedConnector.passwordEncrypted),
  }
  if (!connector || !connector.baseUrl || !connector.username || !connector.passwordPlain) throw new Error('VMware connector settings are incomplete')
  return connector
}

export async function discoverVmwareMachines(settings, connectorId) {
  const connector = resolveConnector(settings, connectorId)
  return connector.kind === 'esxi-host' ? importStandaloneHostMachines(connector) : importVcenterInventory(connector)
}

export async function importVmwareMachines(settings, connectorId) {
  const connector = resolveConnector(settings, connectorId)
  const values = await discoverVmwareMachines(settings, connectorId)
  return importMachines(connector, values)
}

export async function importVmwareSelection(settings, connectorId, vmIds, credentialIds) {
  const connector = resolveConnector(settings, connectorId)
  const selected = new Set(vmIds || [])
  const values = (await discoverVmwareMachines(settings, connectorId)).filter((machine) => selected.has(machine.id))
  return importMachines(connector, values, credentialIds)
}

export async function importVcenterMachines(settings) {
  const connector = { id: 'legacy-vcenter', kind: 'vcenter', name: 'vCenter', ...settings }
  return importVmwareMachines({ connectors: [connector] }, connector.id)
}

export function saveVcenterSettings(payload) {
  const existingConnectors = normalizeVmwareConnectors(getSettings().vcenter)
  const connectors = (payload.connectors || normalizeVmwareConnectors(payload)).map((connector) => ({
    id: connector.id || nanoid(), kind: connector.kind === 'esxi-host' ? 'esxi-host' : 'vcenter', name: connector.name || (connector.kind === 'esxi-host' ? 'Standalone ESXi Host' : 'vCenter'), baseUrl: normalizeBaseUrl(connector.baseUrl), username: connector.username || '', passwordEncrypted: connector.passwordPlain ? encryptSecret(connector.passwordPlain) : connector.passwordEncrypted || existingConnectors.find((item) => item.id === connector.id)?.passwordEncrypted || '', verifyTls: Boolean(connector.verifyTls), autoImportGroupId: connector.autoImportGroupId || '', autoImportGroupName: connector.autoImportGroupName || '',
  }))
  const saved = saveSettings('vcenter', { connectors })
  return {
    ...saved,
    connectors: saved.connectors.map(({ passwordEncrypted, ...connector }) => ({
      ...connector,
      passwordConfigured: Boolean(passwordEncrypted && decryptSecret(passwordEncrypted)),
    })),
  }
}
