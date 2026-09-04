import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { config } from '../config.js'
import { all, get, nowIso, run } from '../db/client.js'

function mapEntry(entry) {
  return {
    ...entry,
    is_published: Boolean(entry.is_published),
  }
}

export function listLibrary() {
  return all(
    `SELECT id, parent_id, type, name, scope, owner_user_id, content, asset_path, language,
            is_published, notes, created_at, updated_at
     FROM library_entries
     ORDER BY scope, type DESC, name ASC`,
  ).map(mapEntry)
}

export function saveLibraryEntry(payload, userId) {
  const timestamp = nowIso()
  const entryId = payload.id || nanoid()
  const existing = payload.id
    ? get('SELECT id, created_at FROM library_entries WHERE id = ?', [payload.id])
    : null

  run(
    `INSERT INTO library_entries (
       id, parent_id, type, name, scope, owner_user_id, content, asset_path, language,
       is_published, notes, created_at, updated_at
     ) VALUES (
       @id, @parentId, @type, @name, @scope, @ownerUserId, @content, @assetPath, @language,
       @isPublished, @notes, @createdAt, @updatedAt
     )
     ON CONFLICT(id) DO UPDATE SET
       parent_id = excluded.parent_id,
       type = excluded.type,
       name = excluded.name,
       scope = excluded.scope,
       content = excluded.content,
       asset_path = excluded.asset_path,
       language = excluded.language,
       is_published = excluded.is_published,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    {
      id: entryId,
      parentId: payload.parentId || null,
      type: payload.type,
      name: payload.name,
      scope: payload.scope,
      ownerUserId: payload.ownerUserId || userId || null,
      content: payload.content || '',
      assetPath: payload.assetPath || '',
      language: payload.language || 'powershell',
      isPublished: payload.isPublished ? 1 : 0,
      notes: payload.notes || '',
      createdAt: existing?.created_at || timestamp,
      updatedAt: timestamp,
    },
  )

  if (payload.type === 'script') {
    run(
      'INSERT INTO script_versions (id, entry_id, version_label, content, created_by, created_at) VALUES (@id, @entryId, @versionLabel, @content, @createdBy, @createdAt)',
      {
        id: nanoid(),
        entryId,
        versionLabel: existing ? `rev-${Date.now()}` : 'v1',
        content: payload.content || '',
        createdBy: userId || null,
        createdAt: timestamp,
      },
    )
  }

  return mapEntry(get('SELECT * FROM library_entries WHERE id = ?', [entryId]))
}

export function deleteLibraryEntry(id) {
  const entry = get('SELECT asset_path FROM library_entries WHERE id = ?', [id])
  if (entry?.asset_path) {
    const fullPath = path.join(config.rootDir, entry.asset_path)
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true })
    }
  }

  run('DELETE FROM library_entries WHERE id = ?', [id])
}

export function listScriptVersions(entryId) {
  return all(
    `SELECT id, entry_id, version_label, content, created_by, created_at
     FROM script_versions
     WHERE entry_id = ?
     ORDER BY created_at DESC`,
    [entryId],
  )
}
