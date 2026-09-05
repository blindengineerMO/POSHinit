import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPsRemotingScript } from './powershellService.js'

test('PowerShell remoting wrapper uses Invoke-Command and enables HTTPS on 5986', () => {
  const command = buildPsRemotingScript({
    target: 'server.example.test',
    port: 5986,
    username: 'DOMAIN\\operator',
    password: 'not-a-real-secret',
    content: "Write-Output 'hello'",
  })

  assert.match(command, /Invoke-Command @invokeParameters/)
  assert.match(command, /Port = 5986/)
  assert.match(command, /\$invokeParameters\.UseSSL = \$true/)
  assert.doesNotMatch(command, /server\.example\.test/)
  assert.doesNotMatch(command, /not-a-real-secret/)
})
