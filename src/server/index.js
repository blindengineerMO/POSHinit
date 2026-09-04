import { createApp } from './app.js'
import { config } from './config.js'
import { initializeDatabase } from './db/bootstrap.js'
import { processDueSchedules } from './services/executionService.js'
import { logger } from './utils/logger.js'

initializeDatabase()

const app = await createApp()

app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'POSHinit listening')
})

setInterval(async () => {
  try {
    const processed = await processDueSchedules()
    if (processed) {
      logger.info({ processed }, 'scheduled executions processed')
    }
  } catch (error) {
    logger.error({ error: error.message }, 'scheduler loop failed')
  }
}, config.schedulerPollMs)
