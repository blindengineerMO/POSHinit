import { nanoid } from 'nanoid'
import { all, get, nowIso, run, transaction } from '../db/client.js'

export function listGroups() {
  return all(
    `SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
            COALESCE(json_group_array(dgm.machine_id), '[]') AS machine_ids_json
     FROM deployment_groups g
     LEFT JOIN deployment_group_machines dgm ON dgm.group_id = g.id
     GROUP BY g.id
     ORDER BY g.name ASC`,
  ).map((group) => ({
    ...group,
    machineIds: JSON.parse(group.machine_ids_json).filter(Boolean),
  }))
}

export function saveGroup(payload) {
  const groupId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id
    ? get('SELECT created_at FROM deployment_groups WHERE id = ?', [payload.id])
    : null

  transaction(() => {
    run(
      `INSERT INTO deployment_groups (id, name, description, created_at, updated_at)
       VALUES (@id, @name, @description, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         updated_at = excluded.updated_at`,
      {
        id: groupId,
        name: payload.name,
        description: payload.description || '',
        createdAt: existing?.created_at || timestamp,
        updatedAt: timestamp,
      },
    )

    run('DELETE FROM deployment_group_machines WHERE group_id = ?', [groupId])
    ;(payload.machineIds || []).forEach((machineId) => {
      run(
        'INSERT INTO deployment_group_machines (group_id, machine_id) VALUES (@groupId, @machineId)',
        { groupId, machineId },
      )
    })
  })

  return get('SELECT id, name, description, created_at, updated_at FROM deployment_groups WHERE id = ?', [
    groupId,
  ])
}
