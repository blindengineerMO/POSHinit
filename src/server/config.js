import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

dotenv.config()

const rootDir = process.cwd()
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data')
const uploadsDir = path.join(dataDir, 'uploads')
const logsDir = path.join(dataDir, 'logs')
const port = Number(process.env.PORT || 4000)
const publicAppUrl = (process.env.PUBLIC_APP_URL || `http://localhost:${port}`).replace(/\/$/, '')

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  host: process.env.HOST || '0.0.0.0',
  rootDir,
  dataDir,
  uploadsDir,
  logsDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'poshinit.sqlite'),
  vaultSecret:
    process.env.VAULT_SECRET || 'poshinit-dev-secret-change-me-before-production',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
  publicAppUrl,
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID || '',
    clientId: process.env.ENTRA_CLIENT_ID || '',
    clientSecret: process.env.ENTRA_CLIENT_SECRET || '',
    redirectUri: process.env.ENTRA_REDIRECT_URI || `${publicAppUrl}/auth/entra/callback`,
  },
  schedulerPollMs: Number(process.env.SCHEDULER_POLL_MS || 15000),
  workerPollMs: Number(process.env.WORKER_POLL_MS || 1000),
  inventorySyncPollMs: Number(process.env.INVENTORY_SYNC_POLL_MS || 60000),
  demoPassword: process.env.DEMO_PASSWORD || 'ChangeMe123!',
  webhookSecret: process.env.WEBHOOK_SECRET || 'poshinit-webhook-secret',
}

export const isProduction = config.nodeEnv === 'production'
