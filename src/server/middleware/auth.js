import { get } from '../db/client.js'
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

  const user = get('SELECT id, name, email, role, status FROM users WHERE id = ?', [payload.userId])
  if (!user) {
    const error = new Error('User not found')
    error.statusCode = 401
    return next(error)
  }

  req.user = user
  return next()
}
