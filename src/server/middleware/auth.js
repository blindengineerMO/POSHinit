import { get } from '../db/client.js'
import { assertResourcePermission, hasPermission } from '../services/rbacService.js'
import { verifyToken } from '../utils/crypto.js'

export function requireAuth(req, _res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const payload = verifyToken(token)

  if (!payload?.userId) {
    const error = new Error('Authentication required')
    error.statusCode = 401
    return next(error)
  }

  const user = get('SELECT id, name, email, role, status, entra_enabled, entra_email FROM users WHERE id = ?', [payload.userId])
  if (!user) {
    const error = new Error('User not found')
    error.statusCode = 401
    return next(error)
  }

  if (user.status !== 'active') {
    const error = new Error('This account is disabled')
    error.statusCode = 403
    return next(error)
  }

  req.user = { ...user, entraEnabled: Boolean(user.entra_enabled), entraEmail: user.entra_email || '' }
  return next()
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (hasPermission(req.user, permission)) return next()
    const error = new Error(`Your role does not have permission to ${permission}`)
    error.statusCode = 403
    return next(error)
  }
}

export function requireResourcePermission(action, resourceType, resolveId = (req) => req.params.id || req.body?.id || '*') {
  return (req, _res, next) => {
    try {
      assertResourcePermission(req.user, action, resourceType, resolveId(req))
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
