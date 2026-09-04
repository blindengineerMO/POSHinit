import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { config } from '../config.js'

export function listUsers() {
  return all(
    'SELECT id, name, email, role, status, created_at, updated_at FROM users ORDER BY name ASC',
  )
}

export function saveUser(payload) {
  const userId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id
    ? get('SELECT created_at, password_hash FROM users WHERE id = ?', [payload.id])
    : null

  run(
    `INSERT INTO users (id, name, email, role, status, password_hash, created_at, updated_at)
     VALUES (@id, @name, @email, @role, @status, @passwordHash, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       email = excluded.email,
       role = excluded.role,
       status = excluded.status,
       password_hash = excluded.password_hash,
       updated_at = excluded.updated_at`,
    {
      id: userId,
      name: payload.name,
      email: payload.email,
      role: payload.role || 'operator',
      status: payload.status || 'active',
      passwordHash: payload.password
        ? bcrypt.hashSync(payload.password, 10)
        : existing?.password_hash || bcrypt.hashSync(config.demoPassword, 10),
      createdAt: existing?.created_at || timestamp,
      updatedAt: timestamp,
    },
  )

  return get('SELECT id, name, email, role, status, created_at, updated_at FROM users WHERE id = ?', [
    userId,
  ])
}
