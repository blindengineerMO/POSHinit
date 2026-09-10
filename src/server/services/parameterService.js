import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { decryptSecret, encryptSecret } from '../utils/crypto.js'

export const parameterTypes = ['string', 'number', 'boolean', 'date', 'enum', 'array', 'machine', 'group', 'credential']

function fail(message) { const error = new Error(message); error.statusCode = 400; throw error }
function parseJson(value, fallback = {}) { try { return JSON.parse(value || '') } catch { return fallback } }

export function normalizeParameterSchema(schema = []) {
  if (!Array.isArray(schema)) fail('Parameter schema must be an array')
  const names = new Set()
  return schema.map((raw) => {
    const name = String(raw.name || '').trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail('Parameter names must be valid PowerShell variable names')
    if (names.has(name.toLowerCase())) fail(`Parameter ${name} is defined more than once`)
    names.add(name.toLowerCase())
    const type = parameterTypes.includes(raw.type) ? raw.type : 'string'
    const options = Array.isArray(raw.options) ? raw.options.map((option) => String(option)) : []
    if (type === 'enum' && !options.length) fail(`Enum parameter ${name} requires options`)
    return { name, label: String(raw.label || name), description: String(raw.description || ''), type, required: Boolean(raw.required), default: raw.default ?? '', options, sensitive: Boolean(raw.sensitive), condition: raw.condition || null, validation: String(raw.validation || '').trim() }
  })
}

function conditionApplies(condition, values) {
  if (!condition) return true
  if (typeof condition === 'object') {
    const actual = values[condition.field]
    if (Object.hasOwn(condition, 'equals')) return actual === condition.equals
    if (Object.hasOwn(condition, 'notEquals')) return actual !== condition.notEquals
    if (Array.isArray(condition.in)) return condition.in.includes(actual)
    return true
  }
  const match = String(condition).match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*['"]?(.+?)['"]?$/)
  return !match || (match[2] === '==' ? String(values[match[1]] ?? '') === match[3] : String(values[match[1]] ?? '') !== match[3])
}

function unseal(value) { return value && typeof value === 'object' && value.__poshinitEncrypted ? decryptSecret(value.__poshinitEncrypted) : value }
function isEmpty(value) { return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) }

function typedValue(field, raw) {
  const value = unseal(raw)
  if (isEmpty(value)) return value
  if (field.type === 'number') { const parsed = Number(value); if (!Number.isFinite(parsed)) fail(`${field.label} must be a number`); return parsed }
  if (field.type === 'boolean') return value === true || value === 'true' || value === 1 || value === '1'
  if (field.type === 'date') { const date = new Date(value); if (Number.isNaN(date.getTime())) fail(`${field.label} must be a valid date`); return date.toISOString() }
  if (field.type === 'array') return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean)
  if (field.type === 'enum') { if (!field.options.includes(String(value))) fail(`${field.label} must be one of: ${field.options.join(', ')}`); return String(value) }
  if (['machine', 'group', 'credential'].includes(field.type)) {
    const table = field.type === 'machine' ? 'machines' : field.type === 'group' ? 'deployment_groups' : 'credentials'
    if (!get(`SELECT id FROM ${table} WHERE id = ?`, [value])) fail(`${field.label} references an unavailable ${field.type}`)
    return String(value)
  }
  return String(value)
}

function validateExpression(field, value) {
  if (!field.validation || isEmpty(value)) return
  const expression = field.validation
  const length = expression.match(/^value\.length\s*(>=|<=|==)\s*(\d+)$/)
  const numeric = expression.match(/^value\s*(>=|<=|>|<|==)\s*(-?\d+(?:\.\d+)?)$/)
  const regex = expression.match(/^regex:(.+)$/)
  const compare = (left, operator, right) => ({ '>': left > right, '<': left < right, '>=': left >= right, '<=': left <= right, '==': left === right })[operator]
  if (length && !compare(String(value).length, length[1], Number(length[2]))) fail(`${field.label} failed validation: ${expression}`)
  else if (numeric && !compare(Number(value), numeric[1], Number(numeric[2]))) fail(`${field.label} failed validation: ${expression}`)
  else if (regex && !(new RegExp(regex[1])).test(String(value))) fail(`${field.label} failed validation pattern`)
  else if (!length && !numeric && !regex) fail(`${field.label} has an unsupported validation expression`)
}

export function resolveParameterValues(schema, rawValues = {}) {
  const fields = normalizeParameterSchema(schema)
  const values = {}
  const sensitiveValues = []
  fields.forEach((field) => {
    if (!conditionApplies(field.condition, values)) return
    const raw = Object.hasOwn(rawValues, field.name) ? rawValues[field.name] : field.default
    const value = typedValue(field, raw)
    if (field.required && isEmpty(value)) fail(`${field.label} is required`)
    validateExpression(field, value)
    if (!isEmpty(value)) values[field.name] = value
    if (field.sensitive && !isEmpty(value)) sensitiveValues.push(String(value))
  })
  return { values, sensitiveValues, schema: fields }
}

export function sealSensitiveParameterValues(schema, values = {}) {
  const fields = normalizeParameterSchema(schema)
  const sensitive = new Set(fields.filter((field) => field.sensitive).map((field) => field.name))
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, sensitive.has(key) && !isEmpty(value) && !(value && value.__poshinitEncrypted) ? { __poshinitEncrypted: encryptSecret(String(value)) } : value]))
}

export function saveParameterSet(payload, userId) {
  const script = get('SELECT parameter_schema_json FROM library_entries WHERE id = ? AND type = ?', [payload.scriptId, 'script'])
  if (!script) fail('Select a valid script for this parameter set')
  const resolved = resolveParameterValues(parseJson(script.parameter_schema_json, []), payload.values || {})
  const id = payload.id || nanoid(); const timestamp = nowIso()
  run(`INSERT INTO parameter_sets (id, name, script_id, values_json, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, script_id = excluded.script_id, values_json = excluded.values_json, updated_at = excluded.updated_at`, [id, String(payload.name || '').trim(), payload.scriptId, JSON.stringify(sealSensitiveParameterValues(resolved.schema, resolved.values)), userId || null, timestamp, timestamp])
  return { ...get('SELECT * FROM parameter_sets WHERE id = ?', [id]), values: resolved.values }
}

export function listParameterSets(scriptId = null) {
  const rows = scriptId ? all('SELECT * FROM parameter_sets WHERE script_id = ? ORDER BY name ASC', [scriptId]) : all('SELECT * FROM parameter_sets ORDER BY name ASC')
  return rows.map((row) => ({ ...row, values: Object.fromEntries(Object.entries(parseJson(row.values_json)).map(([key, value]) => [key, value?.__poshinitEncrypted ? '' : value])), sensitiveKeys: Object.entries(parseJson(row.values_json)).filter(([, value]) => value?.__poshinitEncrypted).map(([key]) => key) }))
}
