import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveParameterValues } from './parameterService.js'

test('schema-driven parameters apply defaults, conditions, arrays, enums, and validation', () => {
  const result = resolveParameterValues([
    { name: 'Mode', type: 'enum', options: ['safe', 'force'], default: 'safe' },
    { name: 'Targets', type: 'array', default: 'one,two' },
    { name: 'Reason', type: 'string', required: true, condition: { field: 'Mode', equals: 'force' }, validation: 'value.length >= 3' },
  ], { Mode: 'force', Reason: 'maintenance' })

  assert.deepEqual(result.values, { Mode: 'force', Targets: ['one', 'two'], Reason: 'maintenance' })
})

test('schema-driven parameters reject missing conditional required fields', () => {
  assert.throws(() => resolveParameterValues([
    { name: 'Mode', type: 'enum', options: ['safe', 'force'], default: 'force' },
    { name: 'Reason', type: 'string', required: true, condition: { field: 'Mode', equals: 'force' } },
  ], {}), /Reason is required/)
})
