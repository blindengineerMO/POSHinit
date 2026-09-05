import test from 'node:test'
import assert from 'node:assert/strict'
import { expandIpv4Cidr } from './subnetScanService.js'

test('CIDR expansion excludes network and broadcast addresses', () => {
  assert.deepEqual(expandIpv4Cidr('192.168.50.0/30'), ['192.168.50.1', '192.168.50.2'])
})

test('CIDR expansion bounds oversized scans', () => {
  assert.throws(() => expandIpv4Cidr('10.0.0.0/20'), /limit scans/i)
})
