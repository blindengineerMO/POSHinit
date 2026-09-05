import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node'
import { nanoid } from 'nanoid'
import { config } from '../config.js'
import { loginWithEntra } from './authService.js'
import { writeLog } from './logService.js'

const pendingAuthorizations = new Map()
const completedSignIns = new Map()
const lifetimeMs = 5 * 60 * 1000
const scopes = ['openid', 'profile', 'email']

function configured() {
  return Boolean(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret)
}

function clearExpired(map) {
  const now = Date.now()
  for (const [key, value] of map.entries()) {
    if (value.expiresAt <= now) map.delete(key)
  }
}

function client() {
  if (!configured()) {
    const error = new Error('Microsoft Entra ID is not configured')
    error.statusCode = 503
    throw error
  }
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.entra.clientId,
      clientSecret: config.entra.clientSecret,
      authority: `https://login.microsoftonline.com/${config.entra.tenantId}`,
    },
  })
}

function landingUrl(parameters = {}) {
  const url = new URL(config.publicAppUrl)
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

export function entraStatus() {
  return { enabled: configured() }
}

export async function beginEntraSignIn(context = {}) {
  clearExpired(pendingAuthorizations)
  const state = nanoid(32)
  const cryptoProvider = new CryptoProvider()
  const pkceCodes = await cryptoProvider.generatePkceCodes()
  pendingAuthorizations.set(state, { verifier: pkceCodes.verifier, expiresAt: Date.now() + lifetimeMs, ip: context.ip || '' })
  writeLog('info', 'auth', 'Enterprise sign-in initiated', { ip: context.ip || '', provider: 'entra' })
  return client().getAuthCodeUrl({
    scopes,
    redirectUri: config.entra.redirectUri,
    state,
    prompt: 'select_account',
    codeChallenge: pkceCodes.challenge,
    codeChallengeMethod: 'S256',
  })
}

export async function finishEntraSignIn({ code, state }, context = {}) {
  clearExpired(pendingAuthorizations)
  const pending = pendingAuthorizations.get(state)
  pendingAuthorizations.delete(state)
  if (!code || !pending) {
    const error = new Error('Enterprise sign-in request expired or could not be verified')
    error.statusCode = 400
    throw error
  }

  const result = await client().acquireTokenByCode({ code, scopes, redirectUri: config.entra.redirectUri, codeVerifier: pending.verifier })
  const claims = result.idTokenClaims || {}
  const email = result.account?.username || claims.preferred_username || claims.email
  const payload = loginWithEntra(email, { ip: context.ip || pending.ip || '' })
  const ticket = nanoid(32)
  completedSignIns.set(ticket, { payload, expiresAt: Date.now() + lifetimeMs })
  return { redirectUrl: landingUrl({ enterpriseTicket: ticket }) }
}

export function consumeEnterpriseTicket(ticket) {
  clearExpired(completedSignIns)
  const entry = completedSignIns.get(ticket)
  completedSignIns.delete(ticket)
  if (!entry) {
    const error = new Error('Enterprise sign-in session expired. Please try again.')
    error.statusCode = 401
    throw error
  }
  return entry.payload
}

export function enterpriseSignInFailure(error, context = {}) {
  writeLog('warning', 'auth', 'Enterprise sign-in failed', { ip: context.ip || '', provider: 'entra', reason: error.message })
}

export function enterpriseFailureRedirect() {
  return landingUrl({ enterpriseError: '1' })
}
