import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProxmoxConnectors, normalizeProxmoxMachine } from './proxmoxService.js'

test('Proxmox resource normalization preserves cluster guest metadata', () => {
  const machine = normalizeProxmoxMachine({ vmid: 104, name: 'web-lxc-01', node: 'pve-node-01', type: 'lxc', status: 'running' })
  assert.deepEqual(machine, { id: 'pve-node-01:104', name: 'web-lxc-01', node: 'pve-node-01', guestOs: 'Linux container', ipAddress: '', powerState: 'running', type: 'lxc' })
})

test('Proxmox settings only accept connector arrays', () => {
  assert.deepEqual(normalizeProxmoxConnectors({}), [])
  assert.deepEqual(normalizeProxmoxConnectors({ connectors: [{ id: 'pve-cluster' }] }), [{ id: 'pve-cluster' }])
})
