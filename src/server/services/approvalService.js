import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { writeLog } from './logService.js'

export function requestScheduleApproval(schedule) {
  const pending = get("SELECT id FROM approvals WHERE entity_type = 'schedule' AND entity_id = ? AND status = 'pending'", [schedule.id])
  if (pending) return pending
  const timestamp = nowIso()
  const approval = { id: nanoid(), entityType: 'schedule', entityId: schedule.id, requestedBy: schedule.created_by || null, notes: `Scheduled run due at ${schedule.next_run_at || timestamp}`, createdAt: timestamp, updatedAt: timestamp }
  run('INSERT INTO approvals (id, entity_type, entity_id, status, requested_by, approved_by, notes, created_at, updated_at) VALUES (@id, @entityType, @entityId, \'pending\', @requestedBy, NULL, @notes, @createdAt, @updatedAt)', approval)
  writeLog('info', 'approval', `Approval requested for schedule ${schedule.name}`, { approvalId: approval.id, scheduleId: schedule.id })
  return approval
}

export function listApprovals() {
  return all(`SELECT a.*, s.name AS schedule_name, u.name AS requester_name, approver.name AS approver_name
    FROM approvals a LEFT JOIN schedules s ON a.entity_type = 'schedule' AND a.entity_id = s.id
    LEFT JOIN users u ON u.id = a.requested_by LEFT JOIN users approver ON approver.id = a.approved_by
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC`).map((item) => ({ ...item, entityType: item.entity_type, entityId: item.entity_id }))
}

export function decideApproval(id, status, userId, notes = '') {
  if (!['approved', 'rejected'].includes(status)) throw new Error('Approval status must be approved or rejected')
  const approval = get("SELECT * FROM approvals WHERE id = ? AND status = 'pending'", [id])
  if (!approval) throw new Error('Pending approval was not found')
  run('UPDATE approvals SET status = ?, approved_by = ?, notes = ?, updated_at = ? WHERE id = ?', [status, userId, notes || approval.notes, nowIso(), id])
  writeLog(status === 'approved' ? 'info' : 'warning', 'approval', `Approval ${status}`, { approvalId: id, entityId: approval.entity_id, decidedBy: userId })
  return { ...approval, status, approved_by: userId, notes: notes || approval.notes }
}
