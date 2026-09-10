import assert from 'node:assert/strict'
import test from 'node:test'
import { providerKinds } from './externalSecretProviderService.js'

test('external secret provider registry identifies implemented and future providers', () => {
  const byId = new Map(providerKinds.map((provider) => [provider.id, provider]))
  assert.equal(byId.get('azure-key-vault').implemented, true)
  assert.equal(byId.get('hashicorp-vault').implemented, true)
  assert.equal(byId.get('cyberark').implemented, false)
  assert.equal(byId.get('aws-secrets-manager').implemented, false)
  assert.equal(byId.get('gcp-secret-manager').implemented, false)
})
