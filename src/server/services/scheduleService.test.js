import assert from 'node:assert/strict'
import test from 'node:test'
import { createToken, verifyToken } from '../utils/crypto.js'
import { computeNextRun } from './scheduleService.js'

test('token round-trip preserves payload', () => {
  const token = createToken({ userId: 'user-1', role: 'admin' })
  const payload = verifyToken(token)

  assert.equal(payload.userId, 'user-1')
  assert.equal(payload.role, 'admin')
})

test('computeNextRun returns an ISO date for recurring schedules', () => {
  const nextRun = computeNextRun(
    {
      mode: 'recurring',
      cronExpression: '0 * * * *',
    },
    new Date('2026-09-04T19:00:00.000Z'),
  )

  assert.match(nextRun, /^\d{4}-\d{2}-\d{2}T/)
})
