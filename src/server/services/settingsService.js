import { get, nowIso, run } from '../db/client.js'
import { encryptSecret } from '../utils/crypto.js'

function readSetting(key) {
  const row = get('SELECT value_json FROM settings WHERE key = ?', [key])
  return row ? JSON.parse(row.value_json) : {}
}

function writeSetting(key, value) {
  run(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES (@key, @valueJson, @updatedAt)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
    {
      key,
      valueJson: JSON.stringify(value),
      updatedAt: nowIso(),
    },
  )
}

function publicEntraSettings(value = {}) {
  return {
    tenantId: value.tenantId || '',
    clientId: value.clientId || '',
    redirectUri: value.redirectUri || '',
    clientSecretConfigured: Boolean(value.clientSecretEncrypted),
  }
}

function publicNotificationSettings(value = {}) {
  return {
    smtpEnabled: Boolean(value.smtpEnabled),
    smtpHost: value.smtpHost || '',
    smtpPort: Number(value.smtpPort || 587),
    smtpSecure: Boolean(value.smtpSecure),
    smtpUsername: value.smtpUsername || '',
    smtpFrom: value.smtpFrom || '',
    smtpTo: value.smtpTo || '',
    smtpPasswordConfigured: Boolean(value.smtpPasswordEncrypted),
    webhookEnabled: Boolean(value.webhookEnabled),
    webhookUrl: value.webhookUrl || '',
    notifyOnSuccess: Boolean(value.notifyOnSuccess),
    notifyOnFailure: value.notifyOnFailure !== false,
  }
}

export function getSettings() {
  const settings = ['branding', 'vcenter', 'azureArc', 'proxmox', 'runtime'].reduce((accumulator, key) => {
    accumulator[key] = readSetting(key)
    return accumulator
  }, {})
  settings.entra = getEntraSettings()
  settings.notifications = getNotificationSettings()
  return settings
}

export function saveSettings(key, value) {
  writeSetting(key, value)
  return getSettings()[key]
}

export function getEntraSettings() {
  return publicEntraSettings(readSetting('entra'))
}

export function getStoredEntraSettings() {
  return readSetting('entra')
}

export function saveEntraSettings(value = {}) {
  const existing = readSetting('entra')
  const clientSecret = String(value.clientSecret || '').trim()
  const next = {
    tenantId: String(value.tenantId || '').trim(),
    clientId: String(value.clientId || '').trim(),
    redirectUri: String(value.redirectUri || '').trim(),
    clientSecretEncrypted: clientSecret ? encryptSecret(clientSecret) : existing.clientSecretEncrypted || '',
  }
  writeSetting('entra', next)
  return publicEntraSettings(next)
}

export function getNotificationSettings() {
  return publicNotificationSettings(readSetting('notifications'))
}

export function getStoredNotificationSettings() {
  return readSetting('notifications')
}

export function saveNotificationSettings(value = {}) {
  const existing = readSetting('notifications')
  const smtpPassword = String(value.smtpPassword || '').trim()
  const webhookUrl = String(value.webhookUrl || '').trim()
  if (webhookUrl) {
    const protocol = new URL(webhookUrl).protocol
    if (!['http:', 'https:'].includes(protocol)) throw new Error('Webhook URL must use HTTP or HTTPS')
  }

  const next = {
    smtpEnabled: Boolean(value.smtpEnabled),
    smtpHost: String(value.smtpHost || '').trim(),
    smtpPort: Number(value.smtpPort || 587),
    smtpSecure: Boolean(value.smtpSecure),
    smtpUsername: String(value.smtpUsername || '').trim(),
    smtpFrom: String(value.smtpFrom || '').trim(),
    smtpTo: String(value.smtpTo || '').trim(),
    smtpPasswordEncrypted: smtpPassword ? encryptSecret(smtpPassword) : existing.smtpPasswordEncrypted || '',
    webhookEnabled: Boolean(value.webhookEnabled),
    webhookUrl,
    notifyOnSuccess: Boolean(value.notifyOnSuccess),
    notifyOnFailure: value.notifyOnFailure !== false,
  }

  if (next.smtpEnabled && (!next.smtpHost || !next.smtpFrom || !next.smtpTo)) {
    throw new Error('SMTP host, sender, and recipient are required when SMTP alerts are enabled')
  }
  if (next.webhookEnabled && !next.webhookUrl) throw new Error('A webhook URL is required when webhook alerts are enabled')

  writeSetting('notifications', next)
  return publicNotificationSettings(next)
}
