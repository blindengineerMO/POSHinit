import bcrypt from 'bcryptjs'
import { get } from '../db/client.js'
import { createToken } from '../utils/crypto.js'
import { writeLog } from './logService.js'
import { dispatchNotificationEvent } from './notificationPolicyService.js'
import { validMfaForUser } from './profileService.js'

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    entraEnabled: Boolean(user.entra_enabled),
    entraEmail: user.entra_email || '',
    theme: user.theme || 'purple',
    mfaEnabled: Boolean(user.mfa_enabled),
  }
}

function createLoginResponse(user) {
  return {
    token: createToken({ userId: user.id, issuedAt: Date.now() }),
    user: publicUser(user),
  }
}

function invalidCredentials(context, email, provider) {
  writeLog('warning', 'auth', `${provider} sign-in failed`, { email: email || '', ip: context.ip || '', provider: provider.toLowerCase() })
  void dispatchNotificationEvent({ type: 'auth.failed', title: `${provider} sign-in failed`, summary: `Failed sign-in for ${email || 'unknown account'}.`, url: '/settings?log=auth', details: { provider: provider.toLowerCase() } })
  const error = new Error('Invalid credentials')
  error.statusCode = 401
  return error
}

export function login({ email, password, mfaCode }, context = {}) {
  const user = get('SELECT * FROM users WHERE email = ?', [email])
  if (!user || user.status !== 'active' || user.entra_enabled || !bcrypt.compareSync(password, user.password_hash) || !validMfaForUser(user, mfaCode)) {
    throw invalidCredentials(context, email, 'Local')
  }

  writeLog('info', 'auth', 'Local sign-in succeeded', { userId: user.id, email: user.email, ip: context.ip || '', provider: 'local' })
  void dispatchNotificationEvent({ type: 'auth.success', title: 'Local sign-in succeeded', summary: `${user.name} signed in.`, url: '/settings?log=auth', details: { userId: user.id } })
  return createLoginResponse(user)
}

export function loginWithEntra(email, context = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const user = get('SELECT * FROM users WHERE entra_enabled = 1 AND entra_email = ? COLLATE NOCASE', [normalizedEmail])
  if (!user || user.status !== 'active') {
    throw invalidCredentials(context, normalizedEmail, 'Enterprise')
  }

  writeLog('info', 'auth', 'Enterprise sign-in succeeded', { userId: user.id, email: normalizedEmail, ip: context.ip || '', provider: 'entra' })
  void dispatchNotificationEvent({ type: 'auth.success', title: 'Enterprise sign-in succeeded', summary: `${user.name} signed in with Entra ID.`, url: '/settings?log=auth', details: { userId: user.id } })
  return createLoginResponse(user)
}

export function recordLogout(user, context = {}) {
  writeLog('info', 'auth', 'Operator signed out', { userId: user.id, email: user.email, ip: context.ip || '', provider: 'session' })
}
