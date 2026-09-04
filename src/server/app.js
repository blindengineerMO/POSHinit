import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { createServer as createViteServer } from 'vite'
import { config, isProduction } from './config.js'
import { errorHandler } from './middleware/errorHandler.js'
import { createRouter } from './routes/index.js'
import { logger } from './utils/logger.js'

export async function createApp() {
  const app = express()

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  )
  app.use(cors({ origin: config.corsOrigin }))
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(
    pinoHttp({
      logger,
    }),
  )

  app.use(createRouter())

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: 'spa',
    })

    app.use(vite.middlewares)
  } else {
    app.use(express.static('dist/client'))
    app.get('/{*splat}', (_req, res) => {
      res.sendFile('index.html', { root: 'dist/client' })
    })
  }

  app.use(errorHandler)

  return app
}
