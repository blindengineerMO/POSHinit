import crypto from 'node:crypto'
import { config } from '../config.js'

const key = crypto.scryptSync(config.vaultSecret, 'poshinit-salt', 32)

export function encryptSecret(value) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptSecret(payload) {
  if (!payload) {
    return ''
  }

  const buffer = Buffer.from(payload, 'base64')
  const iv = buffer.subarray(0, 16)
  const tag = buffer.subarray(16, 32)
  const encrypted = buffer.subarray(32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export function createToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', config.vaultSecret)
    .update(body)
    .digest('base64url')

  return `${body}.${signature}`
}

export function verifyToken(token) {
  if (!token || !token.includes('.')) {
    return null
  }

  const [body, signature] = token.split('.')
  const expected = crypto
    .createHmac('sha256', config.vaultSecret)
    .update(body)
    .digest('base64url')

  if (signature !== expected) {
    return null
  }

  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
}
