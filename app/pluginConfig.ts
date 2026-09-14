// Taut Plugin Defaults
// Reads and parses a plugin's static defaultConfig

import { type ConfigValue, type DefaultConfig, Opt } from '../shared/Plugin'

export type DefaultEntry = {
  key: string
  value: ConfigValue
  comment?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function checkValue(value: unknown, path: string): void {
  if (value === null) return
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`defaultConfig.${path} is not a finite number`)
      }
      return
    case 'object':
      if (Array.isArray(value)) {
        for (const [i, item] of value.entries())
          checkValue(item, `${path}[${i}]`)
        return
      }
      if (isPlainObject(value)) {
        for (const [key, item] of Object.entries(value)) {
          checkValue(item, `${path}.${key}`)
        }
        return
      }
      break
  }
  throw new Error(
    `defaultConfig.${path} must be JSON (string, number, boolean, null, array, or object)`
  )
}

export function validateDefaultConfig(defaults: unknown): void {
  if (typeof defaults === 'string') {
    throw new Error('defaultConfig is an object since Taut v2.14')
  }
  if (!isPlainObject(defaults)) {
    throw new Error('defaultConfig must be a plain object')
  }
  for (const [key, raw] of Object.entries(defaults)) {
    if (!key.trim()) throw new Error('defaultConfig has an empty key')
    const value = raw instanceof Opt ? raw.value : raw
    if (raw instanceof Opt && typeof raw.comment !== 'string') {
      throw new Error(`defaultConfig.${key} has a non-string comment`)
    }
    checkValue(value, key)
  }
  const enabled = defaults.enabled
  const enabledValue = enabled instanceof Opt ? enabled.value : enabled
  if (typeof enabledValue !== 'boolean') {
    throw new Error('defaultConfig.enabled must be a boolean')
  }
}

/** The entries in declaration order */
export function defaultEntries(defaults: DefaultConfig): DefaultEntry[] {
  return Object.entries(defaults).map(([key, raw]) =>
    raw instanceof Opt
      ? { key, value: raw.value, comment: raw.comment }
      : { key, value: raw }
  )
}

/** The defaults as a plain config object */
export function unwrapDefaults(
  defaults: DefaultConfig
): Record<string, ConfigValue> {
  const out: Record<string, ConfigValue> = {}
  for (const { key, value } of defaultEntries(defaults)) out[key] = value
  return out
}

/** A plugin's description as config.jsonc header comment lines */
export function descriptionLines(description: string): string[] {
  return description
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
