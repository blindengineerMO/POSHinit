import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { config } from '../config.js'
import { supportedRoles } from './rbacService.js'

function mapUser(user) {
  return { ...user, entraEnabled: Boolean(user.entra_enabled), entraEmail: user.entra_email || '' }
}

export function listUsers() {
  return all(
    'SELECT id, name, email, role, status, entra_enabled, entra_email, created_at, updated_at FROM users ORDER BY name ASC',
  ).map(mapUser)
}

export function saveUser(payload) {
  const userId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id
    ? get('SELECT created_at, password_hash FROM users WHERE id = ?', [payload.id])
    : null
  const entraEnabled = Boolean(payload.entraEnabled)
  const role = supportedRoles.includes(payload.role) ? payload.role : 'operator'
  const entraEmail = entraEnabled ? String(payload.entraEmail || '').trim().toLowerCase() : null
  if (entraEnabled && !entraEmail) {
    const error = new Error('An Entra ID email is required when enterprise sign-in is enabled')
    error.statusCode = 400
    throw error
  }

  run(
    `INSERT INTO users (id, name, email, role, status, entra_enabled, entra_email, password_hash, created_at, updated_at)
     VALUES (@id, @name, @email, @role, @status, @entraEnabled, @entraEmail, @passwordHash, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       email = excluded.email,
       role = excluded.role,
       status = excluded.status,
       entra_enabled = excluded.entra_enabled,
       entra_email = excluded.entra_email,
       password_hash = excluded.password_hash,
       updated_at = excluded.updated_at`,
    {
      id: userId,
      name: payload.name,
      email: payload.email,
      role,
      status: payload.status || 'active',
      entraEnabled: entraEnabled ? 1 : 0,
      entraEmail,
      passwordHash: payload.password
        ? bcrypt.hashSync(payload.password, 10)
        : existing?.password_hash || bcrypt.hashSync(config.demoPassword, 10),
      createdAt: existing?.created_at || timestamp,
      updatedAt: timestamp,
    },
  )

  return mapUser(get('SELECT id, name, email, role, status, entra_enabled, entra_email, created_at, updated_at FROM users WHERE id = ?', [userId]))
}
