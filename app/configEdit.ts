// Taut Config Edits
// Splices plugin defaults into config.jsonc by hand so the user's comments and
// formatting survive

import type { ConfigValue } from '../shared/Plugin'
import type { JsoncNode, JsoncParser } from './cdn'
import { deepEqual } from './helpers'
import type { DefaultEntry } from './pluginConfig'

export type Layout = { eol: string; unit: string }

const PARSE_OPTIONS = { allowTrailingComma: true }

/** Line ending and indent unit the file already uses */
export function detectLayout(text: string): Layout {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let unit = ''
  for (const line of text.split('\n')) {
    const ws = line.match(/^[ \t]+/)?.[0]
    if (ws && (!unit || ws.length < unit.length)) unit = ws
  }
  return { eol, unit: unit || '  ' }
}

const lineStart = (text: string, pos: number) =>
  text.lastIndexOf('\n', pos - 1) + 1

const leadingWs = (text: string, pos: number) =>
  text.slice(lineStart(text, pos), pos).match(/^[ \t]*/)?.[0] ?? ''

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const isScalar = (value: ConfigValue) =>
  value === null || typeof value !== 'object'

/** Render a value as JSONC lines */
export function renderValue(value: ConfigValue, unit: string): string[] {
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      return [`[${value.map((v) => JSON.stringify(v)).join(', ')}]`]
    }
    const items = value.map((item) => renderValue(item, unit))
    return ['[', ...joinEntries(items, false).map((l) => unit + l), ']']
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => ({
      key,
      value: item,
    }))
    if (entries.length === 0) return ['{}']
    const inner = joinEntries(renderEntries(entries, unit), false)
    return ['{', ...inner.map((l) => unit + l), '}']
  }
  return [JSON.stringify(value)]
}

/** One line group per entry: its comment lines, then `"key": value` */
export function renderEntries(
  entries: DefaultEntry[],
  unit: string
): string[][] {
  return entries.map(({ key, value, comment }) => {
    const lines = renderValue(value, unit)
    lines[0] = `${JSON.stringify(key)}: ${lines[0]}`
    const comments = comment
      ? comment.split(/\r?\n/).map((l) => `// ${l}`.trimEnd())
      : []
    return [...comments, ...lines]
  })
}

/** Flatten entry groups, adding the separating commas */
function joinEntries(entries: string[][], trailingComma: boolean): string[] {
  return entries.flatMap((entry, i) => {
    const lines = [...entry]
    if (trailingComma || i < entries.length - 1) {
      lines[lines.length - 1] += ','
    }
    return lines
  })
}

/**
 * Append entries at the end of an object node, matching the surrounding
 * indentation and trailing-comma style, leaving everything else untouched.
 */
export function appendEntries(
  text: string,
  node: JsoncNode,
  entries: string[][],
  layout: Layout
): string {
  const { eol, unit } = layout
  const open = node.offset
  const close = node.offset + node.length - 1
  const children = node.children ?? []
  const last = children[children.length - 1]
  const keyIndent = leadingWs(text, open)

  const afterLast = last ? last.offset + last.length : open + 1
  const trailingComma =
    last !== undefined &&
    stripComments(text.slice(afterLast, close)).includes(',')

  const firstOnOwnLine =
    children.length > 0 &&
    lineStart(text, children[0].offset) !== lineStart(text, open)
  const childIndent = firstOnOwnLine
    ? leadingWs(text, children[0].offset)
    : keyIndent + unit

  const block = joinEntries(entries, trailingComma)
    .map((l) => (l ? childIndent + l : l))
    .join(eol)

  const closeOnOwnLine = /^[ \t]*$/.test(
    text.slice(lineStart(text, close), close)
  )
  let result: string
  if (closeOnOwnLine) {
    const at = lineStart(text, close)
    result = text.slice(0, at) + block + eol + text.slice(at)
  } else {
    const head = text.slice(0, close).replace(/[ \t]+$/, '')
    result = head + eol + block + eol + keyIndent + text.slice(close)
  }
  if (last && !trailingComma) {
    result = `${result.slice(0, afterLast)},${result.slice(afterLast)}`
  }
  return result
}

export type EditOutcome =
  | { text: string }
  | { unchanged: true }
  | { reason: string }

/**
 * Add a plugin's block to config.jsonc, or append the default entries its
 * block is missing
 */
export function addPluginDefaults(
  jsonc: JsoncParser,
  text: string,
  id: string,
  entries: DefaultEntry[],
  header: string[]
): EditOutcome {
  const errors: import('jsonc-parser').ParseError[] = []
  const tree = jsonc.parseTree(text, errors, PARSE_OPTIONS)
  if (!tree || errors.length > 0) {
    return { reason: 'config.jsonc has syntax errors' }
  }
  if (tree.type !== 'object') {
    return { reason: 'config.jsonc is not an object' }
  }
  const layout = detectLayout(text)

  const plugins = jsonc.findNodeAtLocation(tree, ['plugins'])
  if (!plugins) {
    const withPlugins = appendEntries(text, tree, [['"plugins": {}']], layout)
    const retry = jsonc.parseTree(withPlugins, [], PARSE_OPTIONS)
    if (!retry || !jsonc.findNodeAtLocation(retry, ['plugins'])) {
      return { reason: 'could not add a "plugins" object' }
    }
    return addPluginDefaults(jsonc, withPlugins, id, entries, header)
  }
  if (plugins.type !== 'object') {
    return { reason: '"plugins" is not an object' }
  }

  const block = jsonc.findNodeAtLocation(plugins, [id])
  if (!block) {
    const inner = joinEntries(renderEntries(entries, layout.unit), false)
    const entry = [
      ...header.map((line) => `// ${line}`.trimEnd()),
      `${JSON.stringify(id)}: {`,
      ...inner.map((l) => layout.unit + l),
      '}',
    ]
    return { text: appendEntries(text, plugins, [entry], layout) }
  }
  if (block.type !== 'object') {
    return { reason: `"plugins"."${id}" is not an object` }
  }

  const present = new Set(
    (block.children ?? []).map((prop) => prop.children?.[0]?.value)
  )
  const missing = entries.filter((entry) => !present.has(entry.key))
  if (missing.length === 0) return { unchanged: true }
  return {
    text: appendEntries(
      text,
      block,
      renderEntries(missing, layout.unit),
      layout
    ),
  }
}

type Config = { plugins?: Record<string, unknown>; [key: string]: unknown }

function parseLoose(jsonc: JsoncParser, text: string): Config | null {
  const parsed = jsonc.parse(text, undefined, PARSE_OPTIONS)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Config)
    : null
}

/** Confirm an edit only added plugin `id`'s defaults */
export function checkPluginEdit(
  jsonc: JsoncParser,
  before: string,
  after: string,
  id: string,
  defaults: Record<string, ConfigValue>
): string | null {
  const errors: import('jsonc-parser').ParseError[] = []
  jsonc.parseTree(after, errors, PARSE_OPTIONS)
  if (errors.length > 0) return 'result has syntax errors'

  const prev = parseLoose(jsonc, before) ?? {}
  const next = parseLoose(jsonc, after)
  if (!next) return 'result is not an object'

  const others = (config: Config) => {
    const { plugins, ...rest } = config
    const { [id]: _own, ...otherPlugins } = plugins ?? {}
    return { rest, otherPlugins }
  }
  if (!deepEqual(others(prev), others(next))) {
    return 'something other than this plugin changed'
  }

  const block = next.plugins?.[id]
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return 'plugin block is missing'
  }
  const prevBlock = prev.plugins?.[id]
  const prevEntries =
    prevBlock && typeof prevBlock === 'object'
      ? Object.entries(prevBlock as Record<string, unknown>)
      : []
  for (const [key, value] of prevEntries) {
    if (!deepEqual((block as Record<string, unknown>)[key], value)) {
      return `existing option "${key}" changed`
    }
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(block, key)) return `option "${key}" was not added`
    if (
      !prevEntries.some(([k]) => k === key) &&
      !deepEqual((block as Record<string, unknown>)[key], value)
    ) {
      return `option "${key}" was written with the wrong value`
    }
  }
  return null
}
