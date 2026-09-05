import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAzureArcConnectors, normalizeAzureArcMachine } from './azureArcService.js'

test('Azure Arc resource normalization preserves inventory metadata', () => {
  const machine = normalizeAzureArcMachine({
    id: '/subscriptions/subscription-1/resourceGroups/Operations/providers/Microsoft.HybridCompute/machines/arc-web-01',
    name: 'arc-web-01',
    location: 'centralus',
    tags: { environment: 'production' },
    properties: { dnsFqdn: 'arc-web-01.example.test', osName: 'Windows Server 2022', agentVersion: '1.45.0', status: 'Connected' },
  })
  assert.deepEqual(machine, {
    id: '/subscriptions/subscription-1/resourceGroups/Operations/providers/Microsoft.HybridCompute/machines/arc-web-01',
    name: 'arc-web-01', fqdn: 'arc-web-01.example.test', resourceGroup: 'Operations', location: 'centralus', osFamily: 'windows', osName: 'Windows Server 2022', status: 'Connected', agentVersion: '1.45.0', tags: { environment: 'production' },
  })
})

test('Azure Arc settings only accept connector arrays', () => {
  assert.deepEqual(normalizeAzureArcConnectors({}), [])
  assert.deepEqual(normalizeAzureArcConnectors({ connectors: [{ id: 'arc-1' }] }), [{ id: 'arc-1' }])
})
