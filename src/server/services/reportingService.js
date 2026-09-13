import { nanoid } from 'nanoid'
import nodemailer from 'nodemailer'
import { all, get, nowIso, run, transaction } from '../db/client.js'
import { recordAudit, verifyAuditChain } from './auditService.js'
import { getStoredNotificationSettings } from './settingsService.js'
import { decryptSecret } from '../utils/crypto.js'

const templates = new Set(['executive', 'runbook-trend', 'target-trend', 'sla-slo', 'evidence'])
const frequencies = new Set(['daily', 'weekly', 'monthly'])
const parse = (value, fallback = {}) => { try { return JSON.parse(value || '') } catch (_error) { return fallback } }
const bounded = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback))
const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString()
function nextRun(frequency, from = new Date()) { const date = new Date(from); date.setUTCMinutes(0, 0, 0); date.setUTCHours(8); date.setUTCDate(date.getUTCDate() + ({ daily: 1, weekly: 7, monthly: 30 }[frequency] || 7)); return date.toISOString() }
function scheduleShape(row) { return { ...row, recipients: parse(row.recipients_json, []), enabled: Boolean(row.enabled), legalHold: Boolean(row.legal_hold), periodDays: row.period_days, sloSuccessPercent: row.slo_success_percent, sloDurationSeconds: row.slo_duration_seconds, retentionDays: row.retention_days } }
function artifactShape(row) { return { ...row, summary: parse(row.summary_json), legalHold: Boolean(row.legal_hold) } }
function durationSeconds(row) { return row.finished_at ? Math.max(0, (new Date(row.finished_at) - new Date(row.started_at)) / 1000) : 0 }
function csvEscape(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
function spreadsheet(rows) { const cells = (row) => `<Row>${row.map((value) => `<Cell><Data ss:Type="String">${String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</Data></Cell>`).join('')}</Row>`; return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="POSHinit"><Table>${rows.map(cells).join('')}</Table></Worksheet></Workbook>` }
function pdf(text) { const lines = text.split('\n').slice(0, 80).map((line) => line.replace(/[()\\]/g, '\\$&').slice(0, 120)); const stream = `BT /F1 10 Tf 45 760 Td 13 TL ${lines.map((line, index) => `${index ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`; const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]; let output = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n` }); const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(output) }
async function deliverExecutiveSummary(config, artifact) {
  if (!config.recipients?.length) return
  const settings = getStoredNotificationSettings()
  if (!settings.smtpEnabled) return
  const summary = artifact.summary.summary
  const transport = nodemailer.createTransport({ host: settings.smtpHost, port: Number(settings.smtpPort || 587), secure: Boolean(settings.smtpSecure), auth: settings.smtpUsername ? { user: settings.smtpUsername, pass: decryptSecret(settings.smtpPasswordEncrypted) } : undefined })
  await transport.sendMail({ from: settings.smtpFrom, to: config.recipients.join(', '), subject: `[POSHinit] ${config.name}`, text: [`Reporting period: ${artifact.period_start} to ${artifact.period_end}`, `Runs: ${summary.total}`, `Success rate: ${summary.successPercent}%`, `Average duration: ${summary.averageDurationSeconds}s`, `Success SLO: ${summary.slo.successMet ? 'met' : 'at risk'}`, `Duration SLO: ${summary.slo.durationMet ? 'met' : 'at risk'}`].join('\n') })
}

export function listReportSchedules() { return all('SELECT * FROM report_schedules ORDER BY name').map(scheduleShape) }
export function listReportArtifacts(limit = 80) { return all('SELECT a.*, s.name AS schedule_name FROM report_artifacts a LEFT JOIN report_schedules s ON s.id = a.schedule_id ORDER BY a.generated_at DESC LIMIT ?', [bounded(limit, 80, 1, 500)]).map(artifactShape) }

export function saveReportSchedule(payload = {}, actorId) {
  const name = String(payload.name || '').trim()
  const template = templates.has(payload.template) ? payload.template : 'executive'
  const frequency = frequencies.has(payload.frequency) ? payload.frequency : 'weekly'
  if (!name) { const error = new Error('A report schedule name is required'); error.statusCode = 400; throw error }
  const id = payload.id || nanoid(); const timestamp = nowIso(); const existing = payload.id && get('SELECT * FROM report_schedules WHERE id = ?', [payload.id])
  const enabled = payload.enabled !== false; const recipients = Array.isArray(payload.recipients) ? payload.recipients.map((email) => String(email).trim()).filter(Boolean) : []
  run(`INSERT INTO report_schedules (id,name,template,frequency,period_days,recipients_json,slo_success_percent,slo_duration_seconds,retention_days,legal_hold,enabled,next_run_at,last_run_at,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,template=excluded.template,frequency=excluded.frequency,period_days=excluded.period_days,recipients_json=excluded.recipients_json,slo_success_percent=excluded.slo_success_percent,slo_duration_seconds=excluded.slo_duration_seconds,retention_days=excluded.retention_days,legal_hold=excluded.legal_hold,enabled=excluded.enabled,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at`,
  [id, name, template, frequency, bounded(payload.periodDays, 30, 1, 3650), JSON.stringify(recipients), bounded(payload.sloSuccessPercent, 99, 0, 100), bounded(payload.sloDurationSeconds, 3600, 1, 604800), bounded(payload.retentionDays, 365, 1, 36500), payload.legalHold ? 1 : 0, enabled ? 1 : 0, enabled ? (existing?.next_run_at || nextRun(frequency)) : null, existing?.last_run_at || null, existing?.created_by || actorId, existing?.created_at || timestamp, timestamp])
  recordAudit({ actorId, action: 'report.schedule.saved', resourceType: 'report-schedule', resourceId: id, context: { template, frequency, enabled } })
  return scheduleShape(get('SELECT * FROM report_schedules WHERE id = ?', [id]))
}

export function setReportLegalHold(artifactId, legalHold, actorId) {
  const changed = run('UPDATE report_artifacts SET legal_hold = ? WHERE id = ?', [legalHold ? 1 : 0, artifactId]).changes
  if (!changed) { const error = new Error('Report artifact was not found'); error.statusCode = 404; throw error }
  recordAudit({ actorId, action: legalHold ? 'report.legal-hold.applied' : 'report.legal-hold.released', resourceType: 'report-artifact', resourceId: artifactId })
  return artifactShape(get('SELECT * FROM report_artifacts WHERE id = ?', [artifactId]))
}

export function reportingDashboard(periodDays = 30, goals = {}) {
  const start = isoDaysAgo(bounded(periodDays, 30, 1, 3650)); const successGoal = bounded(goals.sloSuccessPercent, 99, 0, 100); const durationGoal = bounded(goals.sloDurationSeconds, 3600, 1, 604800)
  const rows = all(`SELECT e.*, s.name AS script_name, m.name AS machine_name FROM executions e JOIN library_entries s ON s.id=e.script_id JOIN machines m ON m.id=e.machine_id WHERE e.created_at >= ? ORDER BY e.created_at ASC`, [start])
  const total = rows.length; const success = rows.filter((row) => row.status === 'success').length; const durations = rows.filter((row) => row.finished_at).map(durationSeconds); const averageDurationSeconds = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0
  const trendMap = new Map(); const runbookMap = new Map(); const targetMap = new Map()
  rows.forEach((row) => { const day = row.created_at.slice(0, 10); const trend = trendMap.get(day) || { day, total: 0, success: 0, failed: 0 }; trend.total += 1; trend.success += row.status === 'success' ? 1 : 0; trend.failed += row.status === 'success' ? 0 : 1; trendMap.set(day, trend); [[runbookMap, row.script_name], [targetMap, row.machine_name]].forEach(([map, key]) => { const item = map.get(key) || { name: key, total: 0, success: 0, failed: 0, durations: [] }; item.total += 1; item.success += row.status === 'success' ? 1 : 0; item.failed += row.status === 'success' ? 0 : 1; if (row.finished_at) item.durations.push(durationSeconds(row)); map.set(key, item) }) })
  const summarize = (map) => [...map.values()].map((item) => ({ name: item.name, total: item.total, success: item.success, failed: item.failed, successPercent: item.total ? Number((item.success * 100 / item.total).toFixed(1)) : 100, averageDurationSeconds: item.durations.length ? Number((item.durations.reduce((sum, value) => sum + value, 0) / item.durations.length).toFixed(1)) : 0 })).sort((a, b) => b.failed - a.failed || b.total - a.total)
  const successPercent = total ? Number((success * 100 / total).toFixed(1)) : 100
  return { periodStart: start, periodEnd: nowIso(), summary: { total, success, failed: total - success, successPercent, averageDurationSeconds: Number(averageDurationSeconds.toFixed(1)), slo: { successGoal, durationGoal, successMet: successPercent >= successGoal, durationMet: averageDurationSeconds <= durationGoal } }, trend: [...trendMap.values()], runbooks: summarize(runbookMap), targets: summarize(targetMap) }
}

export function generateReport(payload = {}, actorId = null) {
  const schedule = payload.scheduleId ? get('SELECT * FROM report_schedules WHERE id = ?', [payload.scheduleId]) : null
  if (payload.scheduleId && !schedule) { const error = new Error('Report schedule was not found'); error.statusCode = 404; throw error }
  const config = schedule ? scheduleShape(schedule) : { name: String(payload.name || 'On-demand report'), template: templates.has(payload.template) ? payload.template : 'executive', periodDays: bounded(payload.periodDays, 30, 1, 3650), retentionDays: bounded(payload.retentionDays, 365, 1, 36500), legalHold: Boolean(payload.legalHold), sloSuccessPercent: bounded(payload.sloSuccessPercent, 99, 0, 100), sloDurationSeconds: bounded(payload.sloDurationSeconds, 3600, 1, 604800), id: null }
  const dashboard = reportingDashboard(config.periodDays, config)
  const evidence = { auditIntegrity: verifyAuditChain(), approvals: all('SELECT id, entity_type, entity_id, status, change_ticket, created_at, updated_at FROM approvals WHERE created_at >= ? ORDER BY created_at DESC', [dashboard.periodStart]), dispatchEvents: all('SELECT dispatch_id, target_id, sequence, event_type, created_at FROM job_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1000', [dashboard.periodStart]) }
  const summary = { ...dashboard, evidence, template: config.template }
  const timestamp = nowIso(); const artifact = { id: nanoid(), scheduleId: config.id, name: `${config.name} - ${timestamp.slice(0, 10)}`, template: config.template, periodStart: dashboard.periodStart, periodEnd: dashboard.periodEnd, summaryJson: JSON.stringify(summary), generatedBy: actorId, generatedAt: timestamp, expiresAt: config.legalHold ? null : new Date(Date.now() + config.retentionDays * 86400000).toISOString(), legalHold: config.legalHold ? 1 : 0, createdAt: timestamp }
  transaction(() => {
    run('INSERT INTO report_artifacts (id,schedule_id,name,template,period_start,period_end,summary_json,generated_by,generated_at,expires_at,legal_hold,created_at) VALUES (@id,@scheduleId,@name,@template,@periodStart,@periodEnd,@summaryJson,@generatedBy,@generatedAt,@expiresAt,@legalHold,@createdAt)', artifact)
    if (config.id) run('UPDATE report_schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?', [timestamp, nextRun(config.frequency), timestamp, config.id])
  })
  recordAudit({ actorId: actorId || 'system', action: 'report.generated', resourceType: 'report-artifact', resourceId: artifact.id, context: { template: config.template, periodDays: config.periodDays, legalHold: config.legalHold } })
  return artifactShape(get('SELECT * FROM report_artifacts WHERE id = ?', [artifact.id]))
}

export function getReportArtifact(id) { const row = get('SELECT a.*, s.name AS schedule_name FROM report_artifacts a LEFT JOIN report_schedules s ON s.id=a.schedule_id WHERE a.id=?', [id]); return row && artifactShape(row) }
export function exportReportArtifact(id, format = 'csv') {
  const artifact = getReportArtifact(id); if (!artifact) return null
  const rows = [['Metric', 'Value'], ['Report', artifact.name], ['Period start', artifact.period_start], ['Period end', artifact.period_end], ['Total runs', artifact.summary.summary.total], ['Success rate', `${artifact.summary.summary.successPercent}%`], ['Average duration seconds', artifact.summary.summary.averageDurationSeconds], [], ['Runbook', 'Runs', 'Success %', 'Failures', 'Average seconds'], ...artifact.summary.runbooks.map((item) => [item.name, item.total, item.successPercent, item.failed, item.averageDurationSeconds])]
  if (format === 'xlsx') return { contentType: 'application/vnd.ms-excel', extension: 'xls', body: Buffer.from(spreadsheet(rows)) }
  if (format === 'pdf') return { contentType: 'application/pdf', extension: 'pdf', body: pdf(rows.map((row) => row.join(' | ')).join('\n')) }
  return { contentType: 'text/csv', extension: 'csv', body: Buffer.from(rows.map((row) => row.map(csvEscape).join(',')).join('\n')) }
}
export function evidenceBundle(id) { const artifact = getReportArtifact(id); if (!artifact) return null; return { artifact, generatedAt: nowIso(), integrity: verifyAuditChain(), approvals: artifact.summary.evidence.approvals, dispatchEvents: artifact.summary.evidence.dispatchEvents, report: artifact.summary } }
export function pruneExpiredReportArtifacts() { const result = run('DELETE FROM report_artifacts WHERE legal_hold = 0 AND expires_at IS NOT NULL AND expires_at <= ?', [nowIso()]); return result.changes }
export async function processDueReports() { const due = all('SELECT id FROM report_schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?', [nowIso()]); await Promise.all(due.map(async (row) => { const artifact = generateReport({ scheduleId: row.id }, null); const schedule = scheduleShape(get('SELECT * FROM report_schedules WHERE id = ?', [row.id])); try { await deliverExecutiveSummary(schedule, artifact); recordAudit({ actorType: 'system', action: 'report.delivered', resourceType: 'report-artifact', resourceId: artifact.id, context: { recipients: schedule.recipients.length } }) } catch (error) { recordAudit({ actorType: 'system', action: 'report.delivery.failed', resourceType: 'report-artifact', resourceId: artifact.id, outcome: 'failed', context: { reason: error.message } }) } })); return due.length }
