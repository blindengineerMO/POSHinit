import './observability.js'
import { createApp } from './app.js'
import { createServer } from 'node:http'
import { config } from './config.js'
import { initializeDatabase } from './db/bootstrap.js'
import { processDueSchedules } from './services/executionService.js'
import { processQueuedJobs, recoverInterruptedJobs } from './services/jobQueueService.js'
import { attachJobWebSocketGateway } from './services/jobWebSocketService.js'
import { processDueInventorySources } from './services/inventorySourceService.js'
import { logger } from './utils/logger.js'
import { observeOperation } from './observability.js'

initializeDatabase()
const recoveredJobs = recoverInterruptedJobs()
if (recoveredJobs) logger.warn({ recoveredJobs }, 'interrupted target jobs returned to queue')

const app = await createApp()
const server = createServer(app)
attachJobWebSocketGateway(server)

server.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'POSHinit listening')
})

setInterval(async () => {
  try {
    const processed = await observeOperation('queue', 'schedule_poll', {}, () => processDueSchedules())
    if (processed) {
      logger.info({ processed }, 'scheduled executions processed')
    }
  } catch (error) {
    logger.error({ error: error.message }, 'scheduler loop failed')
  }
}, config.schedulerPollMs)

setInterval(async () => {
  try {
    await observeOperation('worker', 'queue_poll', {}, () => processQueuedJobs())
  } catch (error) {
    logger.error({ error: error.message }, 'job worker loop failed')
  }
}, config.workerPollMs)

setInterval(async () => {
  try {
    const processed = await observeOperation('integration', 'inventory_sync_poll', {}, () => processDueInventorySources())
    if (processed) logger.info({ processed }, 'managed inventory sources synchronized')
  } catch (error) {
    logger.error({ error: error.message }, 'inventory source worker failed')
  }
}, config.inventorySyncPollMs)
