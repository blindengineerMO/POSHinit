import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { config } from '../config.js'
import { all, get, nowIso, run } from '../db/client.js'
import { dispatchNotificationEvent } from './notificationPolicyService.js'

function mapEntry(entry) {
  return {
    ...entry,
    is_published: Boolean(entry.is_published),
  }
}

function assetKind(file) {
  const extension = path.extname(file.originalname).toLowerCase()
  if (['.ps1', '.psm1', '.psd1'].includes(extension)) return 'script'
  if (file.mimetype?.startsWith('image/')) return 'image'
  return 'file'
}

function assetEntryPath(entry) {
  if (!entry?.asset_path) return null
  const fullPath = path.resolve(config.rootDir, entry.asset_path)
  const uploadsPath = path.resolve(config.uploadsDir)
  return fullPath.startsWith(`${uploadsPath}${path.sep}`) ? fullPath : null
}

export function listLibrary() {
  return all(
    `SELECT id, parent_id, type, name, scope, owner_user_id, content, asset_path, language,
            is_published, notes, parameter_schema_json, created_at, updated_at
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
       is_published, notes, parameter_schema_json, created_at, updated_at
     ) VALUES (
       @id, @parentId, @type, @name, @scope, @ownerUserId, @content, @assetPath, @language,
       @isPublished, @notes, @parameterSchemaJson, @createdAt, @updatedAt
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
       parameter_schema_json = excluded.parameter_schema_json,
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
      parameterSchemaJson: JSON.stringify(Array.isArray(payload.parameterSchema) ? payload.parameterSchema : []),
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

  const entry = mapEntry(get('SELECT * FROM library_entries WHERE id = ?', [entryId]))
  if (payload.type === 'script') {
    void dispatchNotificationEvent({ type: 'script.edited', title: `${existing ? 'Script updated' : 'Script created'}: ${entry.name}`, summary: `Script Studio change saved by an operator.`, url: `/editor?script=${entryId}`, details: { entryId, userId: userId || '' } })
  }
  return entry
}

export function importLibraryFile(file, payload, userId) {
  const type = assetKind(file)
  const content = type === 'script' ? fs.readFileSync(file.path, 'utf8') : ''
  return saveLibraryEntry({ parentId: payload.parentId || '', type, name: payload.name || file.originalname, scope: payload.scope || 'personal', content, assetPath: path.relative(config.rootDir, file.path), language: type === 'script' ? 'powershell' : type, notes: payload.notes || `Imported file (${file.mimetype || 'unknown type'}).`, isPublished: payload.isPublished === 'true' || payload.isPublished === true }, userId)
}

export function getLibraryAsset(entryId) {
  const entry = get('SELECT id, name, type, content, asset_path FROM library_entries WHERE id = ?', [entryId])
  if (!entry) return null
  return { entry, fullPath: assetEntryPath(entry) }
}

export function getLibraryPreview(entryId) {
  const asset = getLibraryAsset(entryId)
  if (!asset) return null
  if (asset.entry.type === 'script' || asset.entry.type === 'text') return { kind: 'text', name: asset.entry.name, content: asset.entry.content || '' }
  if (asset.entry.type === 'image' && asset.fullPath) return { kind: 'image', name: asset.entry.name }
  if (asset.fullPath && fs.statSync(asset.fullPath).size <= 1024 * 1024) return { kind: 'text', name: asset.entry.name, content: fs.readFileSync(asset.fullPath, 'utf8') }
  return { kind: 'unavailable', name: asset.entry.name }
}

export function deleteLibraryEntry(id) {
  const entry = get('SELECT name, type, asset_path FROM library_entries WHERE id = ?', [id])
  if (entry?.asset_path) {
    const fullPath = assetEntryPath(entry)
    if (fullPath && fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true })
    }
  }

  run('DELETE FROM library_entries WHERE id = ?', [id])
  if (entry?.type === 'script') void dispatchNotificationEvent({ type: 'script.deleted', title: `Script deleted: ${entry.name}`, summary: 'A script was removed from the library.', url: '/editor', details: { entryId: id } })
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
