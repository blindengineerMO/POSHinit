import assert from 'node:assert/strict'
import test from 'node:test'
import { grantActions, grantResourceTypes, hasPermission, hasScopedPermission, supportedRoles } from './rbacService.js'

test('RBAC grants only the permissions assigned to each role', () => {
  assert.equal(hasPermission({ role: 'viewer' }, 'runs:execute'), false)
  assert.equal(hasPermission({ role: 'operator' }, 'runs:execute'), true)
  assert.equal(hasPermission({ role: 'approver' }, 'approvals:decide'), true)
  assert.equal(hasPermission({ role: 'approver' }, 'library:manage'), false)
  assert.equal(hasPermission({ role: 'admin' }, 'identity:manage'), true)
  assert.deepEqual(supportedRoles, ['viewer', 'operator', 'approver', 'admin'])
})

test('scoped RBAC exposes explicit action and resource vocabulary with an admin override', () => {
  assert.deepEqual(grantActions, ['use', 'approve', 'edit', 'admin', 'audit'])
  assert.equal(grantResourceTypes.includes('organization'), true)
  assert.equal(grantResourceTypes.includes('project'), true)
  assert.equal(grantResourceTypes.includes('environment'), true)
  assert.equal(grantResourceTypes.includes('runbook'), true)
  assert.equal(hasScopedPermission({ role: 'admin' }, { action: 'use', resourceType: 'runbook', resourceId: 'any' }), true)
  assert.equal(hasScopedPermission({ role: 'viewer' }, { action: 'use', resourceType: 'runbook' }), false)
})
