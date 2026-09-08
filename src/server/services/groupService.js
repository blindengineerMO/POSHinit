import { nanoid } from 'nanoid'
import { all, get, nowIso, run, transaction } from '../db/client.js'

function normalizeSources(value) {
  return Array.isArray(value)
    ? value.filter((source) => source?.sourceType && source?.connectorId)
      .map((source) => ({ sourceType: String(source.sourceType), connectorId: String(source.connectorId) }))
    : []
}

function wildcardMatcher(pattern) {
  const escaped = String(pattern || '').trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.')
  return new RegExp(`^${escaped}$`, 'i')
}

function mapGroup(group) {
  return {
    ...group,
    groupType: group.group_type || 'manual',
    matchPattern: group.match_pattern || '',
    sourceFilters: JSON.parse(group.source_filters_json || '[]'),
    machineIds: JSON.parse(group.machine_ids_json || '[]').filter(Boolean),
  }
}

function fetchGroups() {
  return all(
    `SELECT g.id, g.name, g.description, g.group_type, g.match_pattern, g.source_filters_json, g.last_synced_at, g.created_at, g.updated_at,
            COALESCE(json_group_array(dgm.machine_id), '[]') AS machine_ids_json
     FROM deployment_groups g
     LEFT JOIN deployment_group_machines dgm ON dgm.group_id = g.id
     GROUP BY g.id
     ORDER BY g.name ASC`,
  ).map(mapGroup)
}

export function listGroups() {
  syncDynamicGroups()
  return fetchGroups()
}

export function syncDynamicGroups() {
  const dynamicGroups = all("SELECT id FROM deployment_groups WHERE group_type = 'dynamic'")
  return dynamicGroups.map((group) => syncDynamicGroup(group.id))
}

export function syncDynamicGroup(groupId) {
  const group = get('SELECT * FROM deployment_groups WHERE id = ?', [groupId])
  if (!group || group.group_type !== 'dynamic') return { groupId, matched: 0, skipped: true }
  const sources = normalizeSources(JSON.parse(group.source_filters_json || '[]'))
  const matcher = wildcardMatcher(group.match_pattern)
  const machines = all('SELECT id, name, fqdn, source_type, source_ref FROM machines WHERE source_type <> ?', ['manual'])
  const machineIds = machines
    .filter((machine) => {
      const connectorId = String(machine.source_ref || '').split(':')[0]
      const sourceMatches = sources.some((source) => source.sourceType === machine.source_type && source.connectorId === connectorId)
      return sourceMatches && (matcher.test(machine.name || '') || matcher.test(machine.fqdn || ''))
    })
    .map((machine) => machine.id)

  transaction(() => {
    run('DELETE FROM deployment_group_machines WHERE group_id = ?', [groupId])
    machineIds.forEach((machineId) => run('INSERT INTO deployment_group_machines (group_id, machine_id) VALUES (?, ?)', [groupId, machineId]))
    const timestamp = nowIso()
    run('UPDATE deployment_groups SET last_synced_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, groupId])
  })
  return { groupId, matched: machineIds.length, skipped: false }
}

export function saveGroup(payload) {
  const groupId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id ? get('SELECT created_at FROM deployment_groups WHERE id = ?', [payload.id]) : null
  const groupType = payload.groupType === 'dynamic' ? 'dynamic' : 'manual'
  const matchPattern = String(payload.matchPattern || '').trim()
  const sourceFilters = normalizeSources(payload.sourceFilters)
  if (groupType === 'dynamic' && !matchPattern) throw new Error('Dynamic groups require a name wildcard rule')
  if (groupType === 'dynamic' && !sourceFilters.length) throw new Error('Select at least one integrated source for a dynamic group')

  transaction(() => {
    run(
      `INSERT INTO deployment_groups (id, name, description, group_type, match_pattern, source_filters_json, last_synced_at, created_at, updated_at)
       VALUES (@id, @name, @description, @groupType, @matchPattern, @sourceFilters, NULL, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         group_type = excluded.group_type,
         match_pattern = excluded.match_pattern,
         source_filters_json = excluded.source_filters_json,
         updated_at = excluded.updated_at`,
      {
        id: groupId,
        name: payload.name,
        description: payload.description || '',
        groupType,
        matchPattern: groupType === 'dynamic' ? matchPattern : null,
        sourceFilters: JSON.stringify(groupType === 'dynamic' ? sourceFilters : []),
        createdAt: existing?.created_at || timestamp,
        updatedAt: timestamp,
      },
    )

    run('DELETE FROM deployment_group_machines WHERE group_id = ?', [groupId])
    if (groupType === 'manual') {
      ;(payload.machineIds || []).forEach((machineId) => run('INSERT INTO deployment_group_machines (group_id, machine_id) VALUES (?, ?)', [groupId, machineId]))
    }
  })

  if (groupType === 'dynamic') syncDynamicGroup(groupId)
  return fetchGroups().find((group) => group.id === groupId)
}
