import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRuntimeSettings } from './settingsService.js'

test('runtime reliability controls are bounded and preserve supported worker modes', () => {
  const settings = normalizeRuntimeSettings({
    workerMode: 'draining',
    maxConcurrentTargets: 999,
    maxDispatchesPerMinute: -1,
    retryBaseSeconds: 0,
    circuitOpenSeconds: 999999,
  })

  assert.equal(settings.workerMode, 'draining')
  assert.equal(settings.maxConcurrentTargets, 100)
  assert.equal(settings.maxDispatchesPerMinute, 0)
  assert.equal(settings.retryBaseSeconds, 1)
  assert.equal(settings.circuitOpenSeconds, 86400)
})
