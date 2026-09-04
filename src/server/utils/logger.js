import path from 'node:path'
import pino from 'pino'
import { config } from '../config.js'
import { ensureDir } from './fs.js'

ensureDir(config.logsDir)

const fileStream = pino.destination({
  dest: path.join(config.logsDir, 'app.log'),
  mkdir: true,
  sync: false,
})

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: 'poshinit' },
  },
  pino.multistream([{ stream: process.stdout }, { stream: fileStream }]),
)
