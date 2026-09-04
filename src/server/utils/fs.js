import fs from 'node:fs'

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}
