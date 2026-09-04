import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.js'
import { ensureDir } from '../utils/fs.js'

ensureDir(config.dataDir)
ensureDir(config.uploadsDir)
ensureDir(config.logsDir)

export const db = new DatabaseSync(config.dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

export function nowIso() {
  return new Date().toISOString()
}

export function run(statement, params = {}) {
  return Array.isArray(params)
    ? db.prepare(statement).run(...params)
    : db.prepare(statement).run(params)
}

export function get(statement, params = {}) {
  return Array.isArray(params)
    ? db.prepare(statement).get(...params)
    : db.prepare(statement).get(params)
}

export function all(statement, params = {}) {
  return Array.isArray(params)
    ? db.prepare(statement).all(...params)
    : db.prepare(statement).all(params)
}

export function transaction(callback) {
  db.exec('BEGIN')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
