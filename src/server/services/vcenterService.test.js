import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVmwareConnectors, parseSoapInventory } from './vcenterService.js'

test('standalone host SOAP inventory parser extracts VM properties', () => {
  const inventory = parseSoapInventory('<objects><obj type="VirtualMachine">vm-101</obj><propSet><name>name</name><val>web-01</val></propSet><propSet><name>guest.guestFullName</name><val>Microsoft Windows Server 2022</val></propSet><propSet><name>guest.ipAddress</name><val>10.0.0.25</val></propSet><propSet><name>runtime.powerState</name><val>poweredOn</val></propSet></objects>')
  assert.deepEqual(inventory, [{ id: 'vm-101', name: 'web-01', guestOs: 'Microsoft Windows Server 2022', ipAddress: '10.0.0.25', powerState: 'poweredOn' }])
})

test('legacy vCenter settings become a vCenter connector', () => {
  const connectors = normalizeVmwareConnectors({ baseUrl: 'https://vcenter.example.test', username: 'admin' })
  assert.equal(connectors[0].id, 'legacy-vcenter')
  assert.equal(connectors[0].kind, 'vcenter')
})
