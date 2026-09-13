import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeXenServerMachine } from './xenServerService.js'

test('XenAPI VM normalization preserves guest identity', () => {
  const machine = normalizeXenServerMachine({ name_label: 'xen-app-01', power_state: 'Running', guest_metrics: { networks: { '0/ip': '10.20.30.40' }, os_version: { name: 'Ubuntu 24.04' } } }, 'OpaqueRef:vm-1')
  assert.equal(machine.id, 'OpaqueRef:vm-1')
  assert.equal(machine.name, 'xen-app-01')
  assert.equal(machine.ipAddress, '10.20.30.40')
  assert.equal(machine.guestOs, 'Ubuntu 24.04')
})
