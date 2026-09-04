import { get, nowIso, run } from '../db/client.js'

export function getSettings() {
  return ['branding', 'vcenter', 'notifications', 'runtime'].reduce((accumulator, key) => {
    const row = get('SELECT value_json FROM settings WHERE key = ?', [key])
    accumulator[key] = row ? JSON.parse(row.value_json) : {}
    return accumulator
  }, {})
}

export function saveSettings(key, value) {
  run(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES (@key, @valueJson, @updatedAt)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
    {
      key,
      valueJson: JSON.stringify(value),
      updatedAt: nowIso(),
    },
  )

  return getSettings()[key]
}
