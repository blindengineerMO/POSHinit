import assert from 'node:assert/strict'
import test from 'node:test'
import { redactText } from './outputRedactionService.js'

test('redacts known credential values and common secret assignments', () => {
  const output = redactText('token=abc123 password: hunter2 Authorization: Bearer session-value', ['hunter2'])

  assert.equal(output.includes('abc123'), false)
  assert.equal(output.includes('hunter2'), false)
  assert.equal(output.includes('session-value'), false)
  assert.match(output, /\[REDACTED\]/)
})
