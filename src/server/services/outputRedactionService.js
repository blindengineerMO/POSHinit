import { all } from '../db/client.js'
import { decryptSecret } from '../utils/crypto.js'

let cachedSecrets = []
let cacheExpiresAt = 0

function secretValues() {
  if (Date.now() < cacheExpiresAt) return cachedSecrets
  cachedSecrets = all('SELECT secret_encrypted FROM credentials')
    .map((credential) => {
      try { return decryptSecret(credential.secret_encrypted) } catch (_error) { return '' }
    })
    .filter((value) => value && value.length >= 4)
    .sort((left, right) => right.length - left.length)
  cacheExpiresAt = Date.now() + 30000
  return cachedSecrets
}

export function redactText(value, secrets = []) {
  let output = String(value || '')
  secrets.forEach((secret) => { output = output.replaceAll(secret, '[REDACTED]') })
  return output
    .replace(/(authorization\s*:\s*bearer\s+)[^\s'"\r\n]+/gi, '$1[REDACTED]')
    .replace(/\b(password|passwd|token|api[_-]?key|client[_-]?secret)\b\s*([:=])\s*([^\s,;\r\n]+)/gi, '$1$2[REDACTED]')
}

export function redactOutput(value) {
  return redactText(value, secretValues())
}
