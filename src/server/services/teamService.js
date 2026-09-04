import { nanoid } from 'nanoid'
import { all, get, nowIso, run, transaction } from '../db/client.js'

export function listTeams() {
  return all(
    `SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
            COALESCE(json_group_array(tm.user_id), '[]') AS member_ids_json
     FROM teams t
     LEFT JOIN team_members tm ON tm.team_id = t.id
     GROUP BY t.id
     ORDER BY t.name ASC`,
  ).map((team) => ({
    ...team,
    memberIds: JSON.parse(team.member_ids_json).filter(Boolean),
  }))
}

export function saveTeam(payload) {
  const teamId = payload.id || nanoid()
  const timestamp = nowIso()
  const existing = payload.id ? get('SELECT created_at FROM teams WHERE id = ?', [payload.id]) : null

  transaction(() => {
    run(
      `INSERT INTO teams (id, name, description, created_at, updated_at)
       VALUES (@id, @name, @description, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         updated_at = excluded.updated_at`,
      {
        id: teamId,
        name: payload.name,
        description: payload.description || '',
        createdAt: existing?.created_at || timestamp,
        updatedAt: timestamp,
      },
    )

    run('DELETE FROM team_members WHERE team_id = ?', [teamId])
    ;(payload.memberIds || []).forEach((userId) => {
      run('INSERT INTO team_members (team_id, user_id) VALUES (@teamId, @userId)', {
        teamId,
        userId,
      })
    })
  })

  return get('SELECT id, name, description, created_at, updated_at FROM teams WHERE id = ?', [teamId])
}
