import nodemailer from 'nodemailer'
import { config } from '../config.js'
import { decryptSecret } from '../utils/crypto.js'
import { writeLog } from './logService.js'
import { getStoredNotificationSettings } from './settingsService.js'

function shouldNotify(settings, status) {
  return status === 'success' ? settings.notifyOnSuccess : settings.notifyOnFailure !== false
}

function alertPayload(execution) {
  return {
    event: 'execution.completed',
    executionId: execution.id,
    status: execution.status,
    triggerType: execution.triggerType,
    scriptName: execution.scriptName,
    machineName: execution.machineName,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    durationMs: execution.durationMs,
    exitCode: execution.exitCode,
    errorSummary: execution.status === 'failed' ? String(execution.stderr || '').slice(0, 1000) : '',
  }
}

function emailBody(payload) {
  const outcome = payload.status === 'success' ? 'completed successfully' : 'failed'
  return [
    `POSHinit execution ${outcome}`,
    `Script: ${payload.scriptName}`,
    `Machine: ${payload.machineName}`,
    `Trigger: ${payload.triggerType}`,
    `Execution: ${payload.executionId}`,
    `Exit code: ${payload.exitCode}`,
    `Duration: ${payload.durationMs} ms`,
    payload.errorSummary ? `Error: ${payload.errorSummary}` : '',
  ].filter(Boolean).join('\n')
}

async function sendSmtpAlert(settings, payload) {
  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: Number(settings.smtpPort || 587),
    secure: Boolean(settings.smtpSecure),
    auth: settings.smtpUsername
      ? { user: settings.smtpUsername, pass: decryptSecret(settings.smtpPasswordEncrypted) }
      : undefined,
  })
  await transport.sendMail({
    from: settings.smtpFrom,
    to: settings.smtpTo,
    subject: `[POSHinit] ${payload.status.toUpperCase()} - ${payload.scriptName} on ${payload.machineName}`,
    text: emailBody(payload),
  })
}

async function sendWebhookAlert(settings, payload) {
  const response = await fetch(settings.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'POSHinit-Alerts/1.0' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Webhook responded with HTTP ${response.status}`)
}

export async function sendExecutionAlert(execution) {
  const settings = getStoredNotificationSettings()
  if (!shouldNotify(settings, execution.status)) return

  const payload = alertPayload(execution)
  const attempts = []
  if (settings.smtpEnabled) attempts.push(['smtp', sendSmtpAlert(settings, payload)])
  if (settings.webhookEnabled) attempts.push(['webhook', sendWebhookAlert(settings, payload)])

  await Promise.all(attempts.map(async ([channel, delivery]) => {
    try {
      await delivery
      writeLog('info', 'notification', `Execution alert delivered through ${channel}`, { executionId: execution.id, status: execution.status })
    } catch (error) {
      writeLog('error', 'notification', `Execution alert delivery failed through ${channel}`, {
        executionId: execution.id,
        status: execution.status,
        reason: error.message,
      })
    }
  }))
}

export async function sendPolicyAlert(policy, event) {
  const settings = getStoredNotificationSettings()
  const eventUrl = new URL(event.url || '/', config.publicAppUrl).toString()
  const payload = {
    event: event.type,
    title: event.title || event.type,
    summary: event.summary || '',
    occurredAt: event.occurredAt || new Date().toISOString(),
    url: eventUrl,
    details: event.details || {},
  }
  const deliveries = []
  if (settings.smtpEnabled && event.recipientEmails?.length) {
    const transport = nodemailer.createTransport({ host: settings.smtpHost, port: Number(settings.smtpPort || 587), secure: Boolean(settings.smtpSecure), auth: settings.smtpUsername ? { user: settings.smtpUsername, pass: decryptSecret(settings.smtpPasswordEncrypted) } : undefined })
    deliveries.push(transport.sendMail({ from: settings.smtpFrom, to: event.recipientEmails.join(', '), subject: `[POSHinit] ${payload.title}`, text: `${payload.summary}\n\nView details: ${payload.url}` }))
  }
  if (policy.webhookUrl) deliveries.push(fetch(policy.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'POSHinit-Alerts/1.0' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) }).then((response) => { if (!response.ok) throw new Error(`Webhook responded with HTTP ${response.status}`) }))
  await Promise.allSettled(deliveries)
}
