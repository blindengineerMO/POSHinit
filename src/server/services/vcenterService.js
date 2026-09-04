import { saveMachine } from './machineService.js'
import { saveSettings } from './settingsService.js'
import { encryptSecret } from '../utils/crypto.js'
import { saveGroup } from './groupService.js'

async function createSession(baseUrl, username, password) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/session`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
  })

  if (!response.ok) {
    throw new Error(`vCenter session failed with status ${response.status}`)
  }

  return response.text()
}

export async function importVcenterMachines(settings) {
  if (!settings.baseUrl || !settings.username || !settings.passwordPlain) {
    throw new Error('vCenter settings are incomplete')
  }

  const sessionId = await createSession(settings.baseUrl, settings.username, settings.passwordPlain)
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/api/vcenter/vm`, {
    headers: {
      'vmware-api-session-id': sessionId,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch virtual machines from vCenter: ${response.status}`)
  }

  const payload = await response.json()
  const values = payload.value || payload || []

  const imported = values.map((item) =>
    saveMachine({
      name: item.name || item.vm || 'Imported VM',
      fqdn: item.name || '',
      ipAddress: '',
      notes: `Imported from vCenter ${settings.baseUrl}`,
      osFamily: 'windows',
      transport: 'ssh',
      port: 22,
      sourceType: 'vcenter',
      sourceRef: item.vm || item.name || '',
    }),
  )

  if (settings.autoImportGroupId) {
    const machineIds = imported.map((machine) => machine.id)
    saveGroup({
      id: settings.autoImportGroupId,
      name: settings.autoImportGroupName || 'Imported vCenter Nodes',
      description: 'Machines imported from vCenter.',
      machineIds,
    })
  }

  return imported
}

export function saveVcenterSettings(payload) {
  return saveSettings('vcenter', {
    baseUrl: payload.baseUrl || '',
    username: payload.username || '',
    passwordEncrypted: payload.passwordPlain ? encryptSecret(payload.passwordPlain) : payload.passwordEncrypted || '',
    verifyTls: Boolean(payload.verifyTls),
    autoImportGroupId: payload.autoImportGroupId || '',
  })
}
