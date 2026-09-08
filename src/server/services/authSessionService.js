import { get, nowIso, run } from '../db/client.js'

const consumedRetentionMs = 24 * 60 * 60 * 1000

function expiresAt(ttlMs) {
  return new Date(Date.now() + ttlMs).toISOString()
}

export function pruneAuthSessions() {
  const now = nowIso()
  const consumedBefore = new Date(Date.now() - consumedRetentionMs).toISOString()
  run('DELETE FROM auth_sessions WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)', [now, consumedBefore])
}

export function createAuthSession(id, kind, payload, ttlMs) {
  run(
    `INSERT INTO auth_sessions (id, kind, payload_json, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, kind, JSON.stringify(payload), expiresAt(ttlMs), nowIso()],
  )
}

export function consumeAuthSession(id, kind) {
  const now = nowIso()
  const session = get(
    `SELECT payload_json FROM auth_sessions
     WHERE id = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?`,
    [id, kind, now],
  )
  if (!session) return null

  // Conditional consumption makes the record single-use across app processes.
  const result = run(
    `UPDATE auth_sessions SET consumed_at = ?
     WHERE id = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?`,
    [now, id, kind, now],
  )
  if (result.changes !== 1) return null

  try {
    return JSON.parse(session.payload_json)
  } catch (_error) {
    return null
  }
}
