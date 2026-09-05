import { get } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'

const templatePattern = /\{\{\s*secret:([^}]+?)\.(username|password|domain|token)\s*\}\}/gi

function powerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export function injectSecretTemplates(content) {
  return String(content || '').replace(templatePattern, (_template, rawName, property) => {
    const name = rawName.trim()
    const credential = get('SELECT name, username, domain_name, secret_type, secret_encrypted FROM credentials WHERE name = ? COLLATE NOCASE', [name])
    if (!credential) throw new Error(`Secret template references an unknown credential: ${name}`)
    if (credential.secret_type === 'token' && property !== 'token') throw new Error(`Token secret ${name} only supports the .token property`)
    if (credential.secret_type !== 'token' && property === 'token') throw new Error(`Credential ${name} does not support the .token property`)
    if (property === 'domain' && credential.secret_type !== 'domain_password') throw new Error(`Credential ${name} does not support the .domain property`)
    const value = property === 'username' ? credential.username : property === 'domain' ? credential.domain_name : decryptSecret(credential.secret_encrypted)
    return powerShellLiteral(value)
  })
}
