import bcrypt from 'bcryptjs'
import { get } from '../db/client.js'
import { createToken } from '../utils/crypto.js'

export function login({ email, password }) {
  const user = get('SELECT * FROM users WHERE email = ?', [email])
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    const error = new Error('Invalid credentials')
    error.statusCode = 401
    throw error
  }

  return {
    token: createToken({
      userId: user.id,
      issuedAt: Date.now(),
    }),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  }
}
