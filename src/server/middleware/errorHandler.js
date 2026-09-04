import { logger } from '../utils/logger.js'

export function errorHandler(error, req, res, _next) {
  logger.error(
    {
      method: req.method,
      path: req.path,
      message: error.message,
      stack: error.stack,
    },
    'request failed',
  )

  res.status(error.statusCode || 500).json({
    error: error.message || 'Unexpected server error',
  })
}
