import assert from 'node:assert/strict'
import test from 'node:test'
import { hasPermission, supportedRoles } from './rbacService.js'

test('RBAC grants only the permissions assigned to each role', () => {
  assert.equal(hasPermission({ role: 'viewer' }, 'runs:execute'), false)
  assert.equal(hasPermission({ role: 'operator' }, 'runs:execute'), true)
  assert.equal(hasPermission({ role: 'approver' }, 'approvals:decide'), true)
  assert.equal(hasPermission({ role: 'approver' }, 'library:manage'), false)
  assert.equal(hasPermission({ role: 'admin' }, 'identity:manage'), true)
  assert.deepEqual(supportedRoles, ['viewer', 'operator', 'approver', 'admin'])
})
