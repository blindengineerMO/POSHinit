import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node'
import { nanoid } from 'nanoid'
import { config } from '../config.js'
import { loginWithEntra } from './authService.js'
import { writeLog } from './logService.js'
import { getStoredEntraSettings } from './settingsService.js'
import { decryptSecret } from '../utils/crypto.js'
import { consumeAuthSession, createAuthSession, pruneAuthSessions } from './authSessionService.js'

const lifetimeMs = 5 * 60 * 1000
const scopes = ['openid', 'profile', 'email']

function entraConfiguration() {
  const stored = getStoredEntraSettings()
  return {
    tenantId: stored.tenantId || config.entra.tenantId,
    clientId: stored.clientId || config.entra.clientId,
    clientSecret: stored.clientSecretEncrypted ? decryptSecret(stored.clientSecretEncrypted) : config.entra.clientSecret,
    redirectUri: stored.redirectUri || config.entra.redirectUri,
  }
}

function configured() {
  const entra = entraConfiguration()
  return Boolean(entra.tenantId && entra.clientId && entra.clientSecret)
}

function client() {
  const entra = entraConfiguration()
  if (!configured()) {
    const error = new Error('Microsoft Entra ID is not configured')
    error.statusCode = 503
    throw error
  }
  return new ConfidentialClientApplication({
    auth: {
      clientId: entra.clientId,
      clientSecret: entra.clientSecret,
      authority: `https://login.microsoftonline.com/${entra.tenantId}`,
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
  pruneAuthSessions()
  const state = nanoid(32)
  const cryptoProvider = new CryptoProvider()
  const pkceCodes = await cryptoProvider.generatePkceCodes()
  createAuthSession(state, 'entra_pkce', { verifier: pkceCodes.verifier, ip: context.ip || '' }, lifetimeMs)
  writeLog('info', 'auth', 'Enterprise sign-in initiated', { ip: context.ip || '', provider: 'entra' })
  const entra = entraConfiguration()
  return client().getAuthCodeUrl({
    scopes,
    redirectUri: entra.redirectUri,
    state,
    prompt: 'select_account',
    codeChallenge: pkceCodes.challenge,
    codeChallengeMethod: 'S256',
  })
}

export async function finishEntraSignIn({ code, state }, context = {}) {
  pruneAuthSessions()
  const pending = code && state ? consumeAuthSession(state, 'entra_pkce') : null
  if (!code || !pending) {
    const error = new Error('Enterprise sign-in request expired or could not be verified')
    error.statusCode = 400
    throw error
  }

  const entra = entraConfiguration()
  const result = await client().acquireTokenByCode({ code, scopes, redirectUri: entra.redirectUri, codeVerifier: pending.verifier })
  const claims = result.idTokenClaims || {}
  const email = result.account?.username || claims.preferred_username || claims.email
  const payload = loginWithEntra(email, { ip: context.ip || pending.ip || '' })
  const ticket = nanoid(32)
  createAuthSession(ticket, 'entra_ticket', { payload }, lifetimeMs)
  return { redirectUrl: landingUrl({ enterpriseTicket: ticket }) }
}

export function consumeEnterpriseTicket(ticket) {
  pruneAuthSessions()
  const entry = consumeAuthSession(ticket, 'entra_ticket')
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
