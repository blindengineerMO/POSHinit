import { get } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'
import { resolveExternalSecret } from './externalSecretProviderService.js'

const localTemplatePattern = /^secret:([^}]+?)\.(username|password|domain|token)$/i
const externalTemplatePattern = /^external:([^:]+):([^#]+?)(?:#(.+))?$/i
const templatePattern = /\{\{\s*([^}]+?)\s*\}\}/gi

function powerShellLiteral(value) { return `'${String(value).replace(/'/g, "''")}'` }

function resolveLocalSecret(rawName, property) {
  const name = rawName.trim()
  const credential = get('SELECT name, username, domain_name, secret_type, secret_encrypted FROM credentials WHERE name = ? COLLATE NOCASE', [name])
  if (!credential) throw new Error(`Secret template references an unknown credential: ${name}`)
  if (credential.secret_type === 'token' && property !== 'token') throw new Error(`Token secret ${name} only supports the .token property`)
  if (credential.secret_type !== 'token' && property === 'token') throw new Error(`Credential ${name} does not support the .token property`)
  if (property === 'domain' && credential.secret_type !== 'domain_password') throw new Error(`Credential ${name} does not support the .domain property`)
  return property === 'username' ? credential.username : property === 'domain' ? credential.domain_name : decryptSecret(credential.secret_encrypted)
}

export async function injectSecretTemplates(content, context = {}) {
  const source = String(content || '')
  const matches = [...source.matchAll(templatePattern)]
  let cursor = 0
  let output = ''
  const secretValues = []
  for (const match of matches) {
    output += source.slice(cursor, match.index)
    const expression = match[1].trim()
    const local = expression.match(localTemplatePattern)
    const external = expression.match(externalTemplatePattern)
    let value
    if (local) value = resolveLocalSecret(local[1], local[2].toLowerCase())
    else if (external) value = await resolveExternalSecret(external[1].trim(), external[2].trim(), external[3]?.trim() || '', context)
    else throw new Error(`Unsupported secret template: ${expression}`)
    secretValues.push(String(value))
    output += powerShellLiteral(value)
    cursor = match.index + match[0].length
  }
  return { content: output + source.slice(cursor), secretValues }
}
