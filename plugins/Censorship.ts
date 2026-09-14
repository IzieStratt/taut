// Masks words you'd rather not read in messages, on your screen only

import { opt, type SlackMessage, TautPlugin } from '$taut'

type Style = 'stars' | 'hashtags' | 'blocks' | 'custom'

const MASK_CHARS: Record<Exclude<Style, 'custom'>, string> = {
  stars: '*',
  hashtags: '#',
  blocks: '█',
}

const TEXT_FIELDS = [
  'text',
  'blocks',
  'blocksProcessed',
  'attachments',
] as const
const TEXT_KEYS = new Set(['text', 'fallback', 'title', 'pretext', 'footer'])

const WORD_CHAR = /[\p{L}\p{N}_]/u

/** one alternative per term, whole words only, any whitespace between words */
function termPattern(term: string): string {
  let pattern = term.split(/\s+/).map(RegExp.escape).join('\\s+')
  const chars = Array.from(term)
  if (WORD_CHAR.test(chars[0])) pattern = `(?<![\\p{L}\\p{N}_])${pattern}`
  if (WORD_CHAR.test(chars[chars.length - 1]))
    pattern = `${pattern}(?![\\p{L}\\p{N}_])`
  return pattern
}

function compileTerms(terms: unknown): RegExp | null {
  if (!Array.isArray(terms)) return null
  const clean = terms
    .filter((term): term is string => typeof term === 'string')
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!clean.length) return null
  try {
    return new RegExp(clean.map(termPattern).join('|'), 'giu')
  } catch {
    return null
  }
}

export default class Censorship extends TautPlugin<typeof Censorship> {
  static readonly id = 'Censorship'
  static readonly pluginName = 'Censorship'
  static readonly description =
    'Masks words you choose in messages, only on your screen'
  static readonly authors = '<@U06UYA5GMB5>, <@U080A3QP42C>'
  static readonly defaultConfig = {
    enabled: false,
    terms: opt(
      ['job', 'employment'],
      'Whole words or phrases to mask, case-insensitive'
    ),
    style: opt(
      'stars' as Style,
      '"stars", "hashtags", "blocks", or "custom" to use the replacement below'
    ),
    replacement: 'uwu',
  }

  private matcher: RegExp | null = null

  private mask = (match: string): string => {
    const style = this.config.style
    if (style === 'custom') return String(this.config.replacement)
    const char = MASK_CHARS[style] ?? MASK_CHARS.stars
    return Array.from(match, (c) => (/\s/.test(c) ? c : char)).join('')
  }

  private censorString(value: string): string {
    if (!this.matcher) return value
    this.matcher.lastIndex = 0
    return value.replace(this.matcher, this.mask)
  }

  /** the same structure with every text key censored, or `value` itself if nothing matched */
  private censorDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      let changed = false
      const next = value.map((item) => {
        const out = this.censorDeep(item)
        if (out !== item) changed = true
        return out
      })
      return changed ? next : value
    }
    if (!value || typeof value !== 'object') return value
    let next: Record<string, unknown> | null = null
    for (const [key, item] of Object.entries(value)) {
      const out =
        TEXT_KEYS.has(key) && typeof item === 'string'
          ? this.censorString(item)
          : this.censorDeep(item)
      if (out === item) continue
      next ??= { ...value }
      next[key] = out
    }
    return next ?? value
  }

  private censorMessage = (
    _ts: string,
    msg: SlackMessage | undefined
  ): SlackMessage | undefined => {
    if (!msg) return msg
    let next: Record<string, unknown> | null = null
    for (const field of TEXT_FIELDS) {
      const out = this.censorDeep(msg[field])
      if (out === msg[field]) continue
      next ??= { ...msg }
      next[field] = out
    }
    return (next as SlackMessage | null) ?? msg
  }

  start(): void {
    this.matcher = compileTerms(this.config.terms)
    if (!this.matcher) {
      this.log('No terms configured, nothing to mask')
      return
    }

    this.api.redux.patchSlice<object>('messages', (_channelId, bucket) =>
      bucket && typeof bucket === 'object'
        ? this.api.redux.mapEntries<SlackMessage>(bucket, this.censorMessage)
        : bucket
    )
    this.api.redux.refresh()
    this.log('Started')
  }
}
