import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { sendPolicyAlert } from './notificationService.js'

const supportedEvents = new Set(['job.success', 'job.failed', 'auth.success', 'auth.failed', 'script.edited', 'script.deleted'])

function mapPolicy(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    window: JSON.parse(row.window_json || '{}'),
    eventTypes: JSON.parse(row.event_types_json || '[]'),
    recipientUserIds: JSON.parse(row.recipient_user_ids_json || '[]'),
    teamIds: JSON.parse(row.team_ids_json || '[]'),
    webhookUrl: row.webhook_url || '',
  }
}

function policyAllowed(policy, at = new Date()) {
  const window = policy.window || {}
  const date = at.toISOString().slice(0, 10)
  if (window.startDate && date < window.startDate) return false
  if (window.endDate && date > window.endDate) return false
  if (window.days?.length && !window.days.includes(at.getDay())) return false
  const time = at.toTimeString().slice(0, 5)
  if (window.startTime && time < window.startTime) return false
  if (window.endTime && time > window.endTime) return false
  return true
}

function recipientEmails(policy) {
  const userIds = new Set(policy.recipientUserIds || [])
  ;(policy.teamIds || []).forEach((teamId) => {
    all('SELECT user_id FROM team_members WHERE team_id = ?', [teamId]).forEach((row) => userIds.add(row.user_id))
  })
  if (!userIds.size) return []
  return all(`SELECT email FROM users WHERE status = 'active' AND id IN (${[...userIds].map(() => '?').join(',')})`, [...userIds])
    .map((row) => row.email)
}

export function listNotificationPolicies() {
  return all('SELECT * FROM notification_policies ORDER BY name ASC').map(mapPolicy)
}

export function saveNotificationPolicy(payload) {
  const id = payload.id || nanoid()
  const timestamp = nowIso()
  const eventTypes = (payload.eventTypes || []).filter((eventType) => supportedEvents.has(eventType))
  if (!payload.name?.trim()) throw new Error('Notification policy name is required')
  if (!eventTypes.length) throw new Error('Select at least one event type')
  if (payload.webhookUrl) {
    const protocol = new URL(payload.webhookUrl).protocol
    if (!['http:', 'https:'].includes(protocol)) throw new Error('Policy webhook URL must use HTTP or HTTPS')
  }
  const existing = payload.id ? get('SELECT created_at FROM notification_policies WHERE id = ?', [payload.id]) : null
  run(`INSERT INTO notification_policies (id, name, enabled, window_json, event_types_json, recipient_user_ids_json, team_ids_json, webhook_url, created_at, updated_at)
    VALUES (@id, @name, @enabled, @windowJson, @eventTypesJson, @recipientUserIdsJson, @teamIdsJson, @webhookUrl, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, window_json = excluded.window_json,
      event_types_json = excluded.event_types_json, recipient_user_ids_json = excluded.recipient_user_ids_json,
      team_ids_json = excluded.team_ids_json, webhook_url = excluded.webhook_url, updated_at = excluded.updated_at`, {
    id, name: payload.name.trim(), enabled: payload.enabled === false ? 0 : 1,
    windowJson: JSON.stringify(payload.window || {}), eventTypesJson: JSON.stringify(eventTypes),
    recipientUserIdsJson: JSON.stringify(payload.recipientUserIds || []), teamIdsJson: JSON.stringify(payload.teamIds || []),
    webhookUrl: payload.webhookUrl?.trim() || '', createdAt: existing?.created_at || timestamp, updatedAt: timestamp,
  })
  return mapPolicy(get('SELECT * FROM notification_policies WHERE id = ?', [id]))
}

export function deleteNotificationPolicy(id) { run('DELETE FROM notification_policies WHERE id = ?', [id]) }
export function setNotificationPolicyEnabled(id, enabled) { run('UPDATE notification_policies SET enabled = @enabled, updated_at = @updatedAt WHERE id = @id', { id, enabled: enabled ? 1 : 0, updatedAt: nowIso() }); return mapPolicy(get('SELECT * FROM notification_policies WHERE id = ?', [id])) }

export async function dispatchNotificationEvent(event) {
  const { observeOperation } = await import('../observability.js')
  return observeOperation('notification', 'dispatch', { eventType: event.type }, async () => {
    const policies = listNotificationPolicies().filter((policy) => policy.enabled && policy.eventTypes.includes(event.type) && policyAllowed(policy))
    await Promise.all(policies.map((policy) => sendPolicyAlert(policy, { ...event, recipientEmails: recipientEmails(policy) })))
  })
}

export async function testNotificationPolicy(id) {
  const policy = listNotificationPolicies().find((item) => item.id === id)
  if (!policy) throw new Error('Notification policy not found')
  await sendPolicyAlert(policy, { type: 'policy.test', title: 'POSHinit notification policy test', summary: 'This is a test notification from the policy editor.', url: '/settings', occurredAt: nowIso(), recipientEmails: recipientEmails(policy) })
}
