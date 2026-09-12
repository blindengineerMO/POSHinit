import crypto from 'node:crypto'
import { nanoid } from 'nanoid'
import { all, get, nowIso, run, transaction } from '../db/client.js'
import { config } from '../config.js'
import { recordAudit } from './auditService.js'

export const releaseStates = ['draft', 'review', 'approved', 'released', 'deprecated', 'retired']
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isSemanticVersion(value) { return semverPattern.test(String(value || '').trim()) }
function json(value, fallback = []) { try { return JSON.parse(value || '') } catch { return fallback } }
function signatureFor(hash, entryId, version) { return crypto.createHmac('sha256', config.vaultSecret).update(`${hash}:${entryId}:${version}`).digest('hex') }
function hashContent(content) { return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex') }

function mapRelease(release) {
  if (!release) return null
  const reviews = all(`SELECT r.*, u.name AS reviewer_name, u.email AS reviewer_email
    FROM runbook_release_reviews r LEFT JOIN users u ON u.id = r.reviewer_id
    WHERE r.release_id = ? ORDER BY r.updated_at ASC`, [release.id])
  const requiredReviewerIds = json(release.required_reviewer_ids_json)
  return {
    ...release,
    requiredReviewerIds,
    reviews: reviews.map((review) => ({ ...review, reviewerId: review.reviewer_id })),
    artifactValid: signatureFor(release.artifact_hash, release.entry_id, release.version) === release.signature
      && hashContent(release.artifact_content) === release.artifact_hash,
  }
}

export function getReleasePolicy(environmentId) {
  const policy = get('SELECT * FROM environment_release_policies WHERE environment_id = ?', [environmentId])
  return {
    environmentId,
    requiredReviewerIds: json(policy?.required_reviewer_ids_json),
    requireChangeTicket: Boolean(policy?.require_change_ticket),
    requireSemver: policy ? Boolean(policy.require_semver) : true,
  }
}

export function saveReleasePolicy(environmentId, payload = {}) {
  if (!get('SELECT id FROM environments WHERE id = ?', [environmentId])) throw new Error('Environment was not found')
  const reviewerIds = [...new Set((payload.requiredReviewerIds || []).filter((id) => get('SELECT id FROM users WHERE id = ?', [id])))]
  run(`INSERT INTO environment_release_policies (environment_id, required_reviewer_ids_json, require_change_ticket, require_semver, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(environment_id) DO UPDATE SET required_reviewer_ids_json=excluded.required_reviewer_ids_json, require_change_ticket=excluded.require_change_ticket, require_semver=excluded.require_semver, updated_at=excluded.updated_at`,
  [environmentId, JSON.stringify(reviewerIds), Number(Boolean(payload.requireChangeTicket)), Number(payload.requireSemver !== false), nowIso()])
  return getReleasePolicy(environmentId)
}

export function listRunbookReleases(entryId) {
  return all(`SELECT rr.*, e.name AS entry_name, env.name AS environment_name
    FROM runbook_releases rr JOIN library_entries e ON e.id = rr.entry_id
    LEFT JOIN environments env ON env.id = rr.environment_id
    WHERE rr.entry_id = ? ORDER BY rr.created_at DESC`, [entryId]).map(mapRelease)
}

export function createRunbookRelease(entryId, payload = {}, actorId) {
  const entry = get("SELECT * FROM library_entries WHERE id = ? AND type = 'script'", [entryId])
  if (!entry) throw new Error('A script runbook is required for release')
  const environmentId = payload.environmentId || entry.environment_id || 'env-default'
  if (!get('SELECT id FROM environments WHERE id = ?', [environmentId])) throw new Error('Target environment was not found')
  const policy = getReleasePolicy(environmentId)
  const version = String(payload.version || '').trim()
  if ((policy.requireSemver || payload.requireSemver !== false) && !isSemanticVersion(version)) throw new Error('Release version must use semantic versioning, for example 1.4.0')
  if (policy.requireChangeTicket && !String(payload.changeTicket || '').trim()) throw new Error('This environment requires a change ticket before review')
  if (get('SELECT id FROM runbook_releases WHERE entry_id = ? AND version = ?', [entryId, version])) throw new Error(`Version ${version} already exists for this runbook`)
  const reviewerIds = [...new Set([...(policy.requiredReviewerIds || []), ...((payload.requiredReviewerIds || []).filter((id) => get('SELECT id FROM users WHERE id = ?', [id])))])]
  if (reviewerIds.includes(actorId)) throw new Error('The release author cannot be a required reviewer')
  const timestamp = nowIso()
  const artifactContent = entry.content || ''
  const artifactHash = hashContent(artifactContent)
  const release = {
    id: nanoid(), entryId, version, state: reviewerIds.length ? 'review' : 'approved', environmentId,
    changeTicket: String(payload.changeTicket || '').trim() || null, artifactContent, artifactHash,
    signature: signatureFor(artifactHash, entryId, version), requiredReviewerIdsJson: JSON.stringify(reviewerIds),
    createdBy: actorId || null, approvedAt: reviewerIds.length ? null : timestamp, approvedBy: reviewerIds.length ? null : actorId || null,
    createdAt: timestamp, updatedAt: timestamp,
  }
  transaction(() => {
    run(`INSERT INTO runbook_releases (id, entry_id, version, state, environment_id, change_ticket, artifact_content, artifact_hash, signature, required_reviewer_ids_json, created_by, approved_at, approved_by, created_at, updated_at)
      VALUES (@id,@entryId,@version,@state,@environmentId,@changeTicket,@artifactContent,@artifactHash,@signature,@requiredReviewerIdsJson,@createdBy,@approvedAt,@approvedBy,@createdAt,@updatedAt)`, release)
    run('UPDATE library_entries SET lifecycle_state = ?, change_ticket = ?, updated_at = ? WHERE id = ?', [release.state, release.changeTicket, timestamp, entryId])
  })
  recordAudit({ actorId, action: 'runbook.release.submitted', resourceType: 'runbook_release', resourceId: release.id, before: { lifecycleState: entry.lifecycle_state }, after: { state: release.state, version, environmentId, artifactHash }, context: { entryId, changeTicket: release.changeTicket, requiredReviewerIds: reviewerIds } })
  return mapRelease(get('SELECT * FROM runbook_releases WHERE id = ?', [release.id]))
}

export function reviewRunbookRelease(releaseId, decision, notes, actorId) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Review decision must be approved or rejected')
  const release = get('SELECT * FROM runbook_releases WHERE id = ?', [releaseId])
  if (!release || release.state !== 'review') throw new Error('This release is not awaiting review')
  const required = json(release.required_reviewer_ids_json)
  if (!required.includes(actorId)) throw new Error('You are not a required reviewer for this release')
  const timestamp = nowIso()
  transaction(() => {
    run(`INSERT INTO runbook_release_reviews (id, release_id, reviewer_id, decision, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(release_id, reviewer_id) DO UPDATE SET decision=excluded.decision, notes=excluded.notes, updated_at=excluded.updated_at`, [nanoid(), releaseId, actorId, decision, String(notes || ''), timestamp, timestamp])
    const reviews = all('SELECT reviewer_id, decision FROM runbook_release_reviews WHERE release_id = ?', [releaseId])
    const approved = required.every((reviewerId) => reviews.some((review) => review.reviewer_id === reviewerId && review.decision === 'approved'))
    const rejected = reviews.some((review) => review.decision === 'rejected')
    const state = rejected ? 'draft' : approved ? 'approved' : 'review'
    run('UPDATE runbook_releases SET state = ?, approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?', [state, approved ? timestamp : null, approved ? actorId : null, timestamp, releaseId])
    run('UPDATE library_entries SET lifecycle_state = ?, updated_at = ? WHERE id = ?', [state, timestamp, release.entry_id])
  })
  const updated = mapRelease(get('SELECT * FROM runbook_releases WHERE id = ?', [releaseId]))
  recordAudit({ actorId, action: `runbook.release.review_${decision}`, resourceType: 'runbook_release', resourceId: releaseId, before: { state: release.state }, after: { state: updated.state }, context: { entryId: release.entry_id, notes: String(notes || '') } })
  return updated
}

export function transitionRunbookRelease(releaseId, targetState, actorId) {
  if (!['released', 'deprecated', 'retired'].includes(targetState)) throw new Error('Unsupported lifecycle transition')
  const release = get('SELECT * FROM runbook_releases WHERE id = ?', [releaseId])
  if (!release) throw new Error('Release was not found')
  if (targetState === 'released' && release.state !== 'approved') throw new Error('Only an approved artifact can be released')
  if (targetState === 'deprecated' && release.state !== 'released') throw new Error('Only a released artifact can be deprecated')
  if (targetState === 'retired' && !['released', 'deprecated'].includes(release.state)) throw new Error('Only released or deprecated artifacts can be retired')
  if (signatureFor(release.artifact_hash, release.entry_id, release.version) !== release.signature || hashContent(release.artifact_content) !== release.artifact_hash) throw new Error('Release artifact signature verification failed')
  const timestamp = nowIso()
  transaction(() => {
    if (targetState === 'released') run("UPDATE runbook_releases SET state = 'deprecated', updated_at = ? WHERE entry_id = ? AND environment_id = ? AND state = 'released'", [timestamp, release.entry_id, release.environment_id])
    run('UPDATE runbook_releases SET state = ?, released_at = ?, released_by = ?, updated_at = ? WHERE id = ?', [targetState, targetState === 'released' ? timestamp : release.released_at, targetState === 'released' ? actorId : release.released_by, timestamp, releaseId])
    const entryState = targetState === 'released' ? 'released' : targetState
    run('UPDATE library_entries SET lifecycle_state = ?, release_version = ?, updated_at = ? WHERE id = ?', [entryState, targetState === 'released' ? release.version : null, timestamp, release.entry_id])
  })
  const updated = mapRelease(get('SELECT * FROM runbook_releases WHERE id = ?', [releaseId]))
  recordAudit({ actorId, action: `runbook.release.${targetState}`, resourceType: 'runbook_release', resourceId: releaseId, before: { state: release.state }, after: { state: updated.state, version: updated.version }, context: { entryId: release.entry_id, environmentId: release.environment_id, artifactHash: release.artifact_hash } })
  return updated
}

export function getReleaseArtifact(releaseId) {
  const release = mapRelease(get('SELECT * FROM runbook_releases WHERE id = ?', [releaseId]))
  if (!release) return null
  return { id: release.id, entryId: release.entry_id, version: release.version, state: release.state, artifactContent: release.artifact_content, artifactHash: release.artifact_hash, signature: release.signature, artifactValid: release.artifactValid }
}
