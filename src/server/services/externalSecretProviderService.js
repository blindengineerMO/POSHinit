import { nanoid } from 'nanoid'
import { nowIso, run } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'
import { getStoredSecretProviderSettings } from './settingsService.js'

export const providerKinds = [
  { id: 'azure-key-vault', label: 'Azure Key Vault', implemented: true },
  { id: 'hashicorp-vault', label: 'HashiCorp Vault', implemented: true },
  { id: 'cyberark', label: 'CyberArk', implemented: false },
  { id: 'aws-secrets-manager', label: 'AWS Secrets Manager', implemented: false },
  { id: 'gcp-secret-manager', label: 'Google Secret Manager', implemented: false },
]

function audit(provider, reference, propertyName, context, status, errorCode = null) {
  run(
    `INSERT INTO external_secret_accesses (id, provider_id, provider_kind, secret_reference, property_name, execution_id, script_id, machine_id, status, error_code, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), provider.id, provider.kind, reference, propertyName || null, context.executionId || null, context.scriptId || null, context.machineId || null, status, errorCode, nowIso()],
  )
}

function readNested(value, selector) {
  if (!selector) return typeof value === 'string' ? value : value?.value ?? value
  return selector.split('.').reduce((current, key) => current?.[key], value)
}

async function azureAccessToken(provider) {
  const body = new URLSearchParams({ client_id: provider.clientId, client_secret: decryptSecret(provider.clientSecretEncrypted), grant_type: 'client_credentials', scope: 'https://vault.azure.net/.default' })
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(provider.tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error(`Azure token request failed (${response.status})`)
  return (await response.json()).access_token
}

async function resolveAzureKeyVault(provider, reference) {
  const token = await azureAccessToken(provider)
  const response = await fetch(`${provider.vaultUrl}/secrets/${encodeURIComponent(reference)}?api-version=7.4`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`Azure Key Vault secret request failed (${response.status})`)
  return (await response.json()).value
}

async function resolveHashicorpVault(provider, reference, selector) {
  const path = `${provider.vaultUrl}/v1/${provider.mountPath.replace(/^\/+|\/+$/g, '')}/${reference.replace(/^\/+/, '')}`
  const response = await fetch(path, { headers: { 'X-Vault-Token': decryptSecret(provider.tokenEncrypted), ...(provider.namespace ? { 'X-Vault-Namespace': provider.namespace } : {}) } })
  if (!response.ok) throw new Error(`HashiCorp Vault secret request failed (${response.status})`)
  const body = await response.json()
  return readNested(body?.data?.data ?? body?.data, selector)
}

export async function resolveExternalSecret(providerId, reference, selector = '', context = {}) {
  const provider = (getStoredSecretProviderSettings().providers || []).find((item) => item.id === providerId)
  if (!provider || !provider.enabled) throw new Error(`External secret provider ${providerId} is unavailable`)
  try {
    const value = provider.kind === 'azure-key-vault'
      ? await resolveAzureKeyVault(provider, reference)
      : provider.kind === 'hashicorp-vault'
        ? await resolveHashicorpVault(provider, reference, selector)
        : (() => { throw new Error(`${provider.kind} provider interface is registered but not implemented yet`) })()
    if (value === undefined || value === null || value === '') throw new Error('External provider returned no secret value')
    audit(provider, reference, selector, context, 'success')
    return String(value)
  } catch (error) {
    audit(provider, reference, selector, context, 'failed', error.message.slice(0, 180))
    throw error
  }
}
