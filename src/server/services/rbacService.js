import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'

const rolePermissions = {
  viewer: ['dashboard:read', 'inventory:read', 'library:read', 'reports:read', 'schedules:read'],
  operator: ['dashboard:read', 'inventory:read', 'inventory:manage', 'library:read', 'library:manage', 'reports:read', 'schedules:read', 'schedules:manage', 'runs:execute', 'vault:manage'],
  approver: ['dashboard:read', 'inventory:read', 'library:read', 'reports:read', 'schedules:read', 'approvals:read', 'approvals:decide'],
  admin: ['*'],
}

export const supportedRoles = Object.keys(rolePermissions)
export const grantActions = ['use', 'approve', 'edit', 'admin', 'audit']
export const grantResourceTypes = ['organization', 'project', 'environment', 'folder', 'runbook', 'inventory', 'credential', 'integration', 'execution']

export function hasPermission(user, permission) {
  const permissions = rolePermissions[user?.role] || []
  return permissions.includes('*') || permissions.includes(permission)
}

function subjectClauses(user) {
  const teams = all('SELECT team_id FROM team_members WHERE user_id = ?', [user.id]).map((row) => row.team_id)
  return [{ type: 'user', id: user.id }, ...teams.map((id) => ({ type: 'team', id }))]
}

function scopeMatches(grant, context) {
  if (grant.organization_id && grant.organization_id !== context.organizationId) return false
  if (grant.project_id && grant.project_id !== context.projectId) return false
  if (grant.environment_id && grant.environment_id !== context.environmentId) return false
  if (grant.resource_type === '*') return true
  if (grant.resource_type === context.resourceType && (grant.resource_id === '*' || grant.resource_id === context.resourceId)) return true
  return grant.resource_type === 'folder' && context.resourceType === 'runbook' && (grant.resource_id === '*' || context.folderIds?.includes(grant.resource_id))
}

export function hasScopedPermission(user, context = {}) {
  if (user?.role === 'admin') return true
  if (!user?.id || !grantActions.includes(context.action) || !grantResourceTypes.includes(context.resourceType)) return false
  const grants = subjectClauses(user).flatMap((subject) => all(
    "SELECT * FROM access_grants WHERE subject_type = ? AND subject_id = ? AND action IN (?, 'admin')",
    [subject.type, subject.id, context.action],
  ))
  return grants.some((grant) => scopeMatches(grant, {
    organizationId: context.organizationId || 'org-default', projectId: context.projectId || 'project-default', environmentId: context.environmentId || 'env-default',
    resourceType: context.resourceType, resourceId: context.resourceId || '*', folderIds: context.folderIds || [],
  }))
}

export function assertScopedPermission(user, context) {
  if (hasScopedPermission(user, context)) return
  const error = new Error(`You do not have ${context.action} access to this ${context.resourceType}`)
  error.statusCode = 403
  throw error
}

function resourceContext(type, id) {
  if (!id || id === '*') return { resourceType: type, resourceId: '*' }
  const tableByType = { runbook: 'library_entries', inventory: 'machines', credential: 'credentials', execution: 'schedules' }
  const table = tableByType[type]
  if (!table) return { resourceType: type, resourceId: id }
  const row = get(`SELECT id, project_id, environment_id${type === 'runbook' ? ', parent_id' : ''} FROM ${table} WHERE id = ?`, [id])
  if (!row) return { resourceType: type, resourceId: id }
  const folderIds = []
  if (type === 'runbook') {
    let parentId = row.parent_id
    while (parentId) { folderIds.push(parentId); parentId = get('SELECT parent_id FROM library_entries WHERE id = ?', [parentId])?.parent_id }
  }
  return { resourceType: type, resourceId: row.id, projectId: row.project_id, environmentId: row.environment_id, folderIds }
}

export function assertResourcePermission(user, action, resourceType, resourceId = '*') {
  assertScopedPermission(user, { action, ...resourceContext(resourceType, resourceId) })
}

export function assertDispatchPermissions(user, payload = {}) {
  ;[...new Set(payload.scriptIds || [])].forEach((id) => assertResourcePermission(user, 'use', 'runbook', id))
  ;[...new Set(payload.machineIds || [])].forEach((id) => {
    assertResourcePermission(user, 'use', 'inventory', id)
    const machine = get('SELECT credential_id FROM machines WHERE id = ?', [id])
    if (machine?.credential_id) assertResourcePermission(user, 'use', 'credential', machine.credential_id)
  })
  assertResourcePermission(user, 'use', 'execution', '*')
}

export function listAccessGrants() {
  return all(`SELECT g.*, u.name AS user_name, t.name AS team_name FROM access_grants g LEFT JOIN users u ON g.subject_type = 'user' AND u.id = g.subject_id LEFT JOIN teams t ON g.subject_type = 'team' AND t.id = g.subject_id ORDER BY g.updated_at DESC`)
}

export function saveAccessGrant(payload, createdBy) {
  if (!['user', 'team'].includes(payload.subjectType) || !payload.subjectId) throw new Error('A user or team principal is required')
  if (!grantActions.includes(payload.action)) throw new Error('Unsupported grant action')
  if (!['*', ...grantResourceTypes].includes(payload.resourceType || '*')) throw new Error('Unsupported grant resource type')
  const id = payload.id || nanoid(); const timestamp = nowIso()
  run(`INSERT INTO access_grants (id, subject_type, subject_id, action, resource_type, resource_id, organization_id, project_id, environment_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET subject_type = excluded.subject_type, subject_id = excluded.subject_id, action = excluded.action, resource_type = excluded.resource_type, resource_id = excluded.resource_id, organization_id = excluded.organization_id, project_id = excluded.project_id, environment_id = excluded.environment_id, updated_at = excluded.updated_at`, [id, payload.subjectType, payload.subjectId, payload.action, payload.resourceType || '*', payload.resourceId || '*', payload.organizationId || null, payload.projectId || null, payload.environmentId || null, createdBy || null, timestamp, timestamp])
  return get('SELECT * FROM access_grants WHERE id = ?', [id])
}

export function deleteAccessGrant(id) { return run('DELETE FROM access_grants WHERE id = ?', [id]).changes > 0 }

export function listScopeHierarchy() {
  return {
    organizations: all('SELECT * FROM organizations ORDER BY name ASC'), projects: all('SELECT * FROM projects ORDER BY name ASC'), environments: all('SELECT * FROM environments ORDER BY name ASC'),
    folders: all("SELECT id, name, project_id, environment_id FROM library_entries WHERE type = 'folder' ORDER BY name ASC"),
  }
}
