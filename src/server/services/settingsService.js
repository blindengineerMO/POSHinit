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

function bounded(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback
}

export function normalizeRuntimeSettings(value = {}) {
  return {
    defaultShell: String(value.defaultShell || 'pwsh'),
    allowManualRuns: value.allowManualRuns !== false,
    workerMode: ['active', 'draining', 'maintenance'].includes(value.workerMode) ? value.workerMode : 'active',
    maxConcurrentTargets: bounded(value.maxConcurrentTargets, 4, 1, 100),
    maxConcurrentPerDispatch: bounded(value.maxConcurrentPerDispatch, 2, 1, 50),
    maxConcurrentPerMachine: bounded(value.maxConcurrentPerMachine, 1, 1, 20),
    maxDispatchesPerMinute: bounded(value.maxDispatchesPerMinute, 60, 0, 10000),
    defaultTargetTimeoutSeconds: bounded(value.defaultTargetTimeoutSeconds, 3600, 10, 86400),
    defaultJobTimeoutSeconds: bounded(value.defaultJobTimeoutSeconds, 0, 0, 604800),
    retryBaseSeconds: bounded(value.retryBaseSeconds, 5, 1, 3600),
    retryMaxSeconds: bounded(value.retryMaxSeconds, 300, 1, 86400),
    circuitFailureThreshold: bounded(value.circuitFailureThreshold, 3, 1, 100),
    circuitOpenSeconds: bounded(value.circuitOpenSeconds, 300, 10, 86400),
  }
}

export function getSettings() {
  const settings = ['branding', 'vcenter', 'azureArc', 'proxmox', 'runtime', 'secretProviders', 'audit'].reduce((accumulator, key) => {
    accumulator[key] = readSetting(key)
    return accumulator
  }, {})
  settings.entra = getEntraSettings()
  settings.notifications = getNotificationSettings()
  settings.runtime = normalizeRuntimeSettings(settings.runtime)
  settings.secretProviders = publicSecretProviderSettings(settings.secretProviders)
  settings.audit = publicAuditSettings(settings.audit)
  return settings
}

function publicAuditSettings(value = {}) { return { syslogHost: value.syslogHost || '', syslogPort: Number(value.syslogPort || 514), webhookUrl: value.webhookUrl || '', webhookConfigured: Boolean(value.webhookTokenEncrypted) } }
export function saveAuditSettings(value = {}) { const existing = readSetting('audit'); const token = String(value.webhookToken || '').trim(); const next = { syslogHost: String(value.syslogHost || '').trim(), syslogPort: Number(value.syslogPort || 514), webhookUrl: String(value.webhookUrl || '').trim(), webhookTokenEncrypted: token ? encryptSecret(token) : existing.webhookTokenEncrypted || '' }; writeSetting('audit', next); return publicAuditSettings(next) }
export function getStoredAuditSettings() { return readSetting('audit') }

function publicSecretProviderSettings(value = {}) {
  return {
    providers: (Array.isArray(value.providers) ? value.providers : []).map(({ clientSecretEncrypted, tokenEncrypted, ...provider }) => ({
      ...provider,
      clientSecretConfigured: Boolean(clientSecretEncrypted),
      tokenConfigured: Boolean(tokenEncrypted),
    })),
  }
}

export function getStoredSecretProviderSettings() { return readSetting('secretProviders') }

export function saveSecretProviderSettings(value = {}) {
  const existing = readSetting('secretProviders')
  const existingById = new Map((existing.providers || []).map((provider) => [provider.id, provider]))
  const supported = new Set(['azure-key-vault', 'hashicorp-vault', 'cyberark', 'aws-secrets-manager', 'gcp-secret-manager'])
  const providers = (Array.isArray(value.providers) ? value.providers : []).map((raw) => {
    if (!supported.has(raw.kind)) throw new Error('Unsupported secret provider type')
    const prior = existingById.get(raw.id) || {}
    const clientSecret = String(raw.clientSecret || '').trim()
    const token = String(raw.token || '').trim()
    const base = { id: String(raw.id || '').trim(), name: String(raw.name || '').trim(), kind: raw.kind, enabled: raw.enabled !== false, vaultUrl: String(raw.vaultUrl || '').trim().replace(/\/$/, ''), tenantId: String(raw.tenantId || '').trim(), clientId: String(raw.clientId || '').trim(), namespace: String(raw.namespace || '').trim(), mountPath: String(raw.mountPath || 'secret').trim() }
    if (!base.id || !base.name) throw new Error('Every secret provider requires an ID and name')
    if (base.kind === 'azure-key-vault' && (!base.vaultUrl || !base.tenantId || !base.clientId || !(clientSecret || prior.clientSecretEncrypted))) throw new Error('Azure Key Vault requires vault URL, tenant ID, client ID, and client secret')
    if (base.kind === 'hashicorp-vault' && (!base.vaultUrl || !(token || prior.tokenEncrypted))) throw new Error('HashiCorp Vault requires URL and token authentication')
    return { ...base, clientSecretEncrypted: clientSecret ? encryptSecret(clientSecret) : prior.clientSecretEncrypted || '', tokenEncrypted: token ? encryptSecret(token) : prior.tokenEncrypted || '' }
  })
  const next = { providers }
  writeSetting('secretProviders', next)
  return publicSecretProviderSettings(next)
}

export function saveSettings(key, value) {
  writeSetting(key, key === 'runtime' ? normalizeRuntimeSettings(value) : value)
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
