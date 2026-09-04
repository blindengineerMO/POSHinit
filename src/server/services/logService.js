import { nanoid } from 'nanoid'
import { all, nowIso, run } from '../db/client.js'

export function writeLog(level, channel, message, context = {}) {
  run(
    'INSERT INTO logs (id, level, channel, message, context_json, created_at) VALUES (@id, @level, @channel, @message, @contextJson, @createdAt)',
    {
      id: nanoid(),
      level,
      channel,
      message,
      contextJson: JSON.stringify(context),
      createdAt: nowIso(),
    },
  )
}

export function searchLogs(query = '') {
  const pattern = `%${query}%`
  return all(
    `SELECT id, level, channel, message, context_json, created_at
     FROM logs
     WHERE message LIKE @pattern OR context_json LIKE @pattern OR channel LIKE @pattern
     ORDER BY created_at DESC
     LIMIT 250`,
    { pattern },
  ).map((entry) => ({
    ...entry,
    context: JSON.parse(entry.context_json),
  }))
}
