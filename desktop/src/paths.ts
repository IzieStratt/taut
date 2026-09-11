// Taut Desktop Paths

import path from 'node:path'
import { app } from 'electron'

export function configDir(): string {
  const override = process.env.TAUT_CONFIG_DIR
  if (override) return path.resolve(override)
  return path.join(app.getPath('appData'), 'Taut')
}
