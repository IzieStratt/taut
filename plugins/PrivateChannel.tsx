// Lets you see and mention private channels you aren't in (uses the flaron index)

import { TautPlugin } from '$taut'

const FLARON = 'https://flaron.halceon.dev'
// Re-pull the full admin export at most this often
const EXPORT_TTL = 6 * 60 * 60 * 1000
// forget a confirmed shadow after this long, so a channel that has since gone
// public (or that we joined) gets resolved by Slack again
const SHADOW_TTL = 24 * 60 * 60 * 1000
// most index entries a single autocomplete query may check against flaron
const MAX_QUERY_LOOKUPS = 5

type ShadowRecord = { name: string; previousNames?: string[] }
type Confirmed = ShadowRecord & { ts: number }
type Snapshot = {
  /** when the admin export was last pulled */
  ts: number
  index?: Record<string, ShadowRecord>
  confirmed?: Record<string, Confirmed>
  /** pre-verification snapshots, loaded as unverified index entries */
  entries?: Record<string, ShadowRecord>
}
type ExportEntry = {
  latest?: string
  private?: boolean
  history?: Array<{ name?: string }>
}

export default class PrivateChannel extends TautPlugin<typeof PrivateChannel> {
  static readonly id = 'PrivateChannel'
  static readonly pluginName = 'Private Channel'
  static readonly description =
    "Lets you see and mention private channels you aren't in (uses the <https://flaron.halceon.dev|flaron> index)"
  static readonly defaultConfig = {
    enabled: false,
  }
  static readonly authors = '<@U06UYA5GMB5>'

  /**
   * key: channel id -> every channel flaron knows a name for. flaron reports
   * `private: true` for public channels too, so these are names only and never
   * stand in for a channel Slack could fetch itself
   */
  private index = new Map<string, ShadowRecord>()
  /** key: channel id -> channels confirmed inaccessible, layered on Slack's cache */
  private shadows = new Map<string, Confirmed>()
  /** ids we've already tried to resolve from flaron */
  private resolved = new Set<string>()
  /** names we've already tried to resolve from flaron */
  private resolvedNames = new Set<string>()
  /** channel objects we built, so we can tell our own reads from Slack's */
  private synthesized = new WeakSet<object>()
  private exportTs = 0
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  private get adminKey(): string {
    const key = this.config.adminKey
    return typeof key === 'string' ? key.trim() : ''
  }

  async start() {
    const snapshot = await this.api.storage.get<Snapshot | null>(
      'channels',
      null
    )
    if (this.api.signal.aborted) return
    this.loadSnapshot(snapshot)

    this.api.redux.patchSlice<{
      name?: string
      isNonExistent?: boolean
      isUnknown?: boolean
    }>(
      'channels',
      (id, channel) => {
        if (channel?.name && !channel.isNonExistent && !channel.isUnknown)
          return channel
        // an unconfirmed name only fills in a stub Slack already gave up on
        // with no entry at all we return nothing, so Slack still fetches
        const rec = this.shadows.get(id) ?? (channel && this.index.get(id))
        if (!rec) return channel
        const shadow = this.api.channels.makeChannelObject({
          id,
          name: rec.name,
          isPrivate: true,
          previousNames: rec.previousNames,
        })
        this.synthesized.add(shadow)
        return shadow
      },
      () => this.shadows.keys()
    )
    this.api.redux.refresh()

    this.patchThunks()
    this.patchChannelRendering()

    // If we have an admin key, keep the full export up to date in the background
    if (this.adminKey && Date.now() - this.exportTs > EXPORT_TTL) {
      this.loadExport().catch((err) => this.log('export failed', err))
    }

    this.log('Started')
  }

  private loadSnapshot(snapshot: Snapshot | null) {
    if (!snapshot) return
    this.exportTs = snapshot.index ? (snapshot.ts ?? 0) : 0
    for (const [id, rec] of Object.entries(
      snapshot.index ?? snapshot.entries ?? {}
    )) {
      if (rec?.name) this.index.set(id, rec)
    }
    const now = Date.now()
    for (const [id, rec] of Object.entries(snapshot.confirmed ?? {})) {
      if (!rec?.name) continue
      this.index.set(id, { name: rec.name, previousNames: rec.previousNames })
      if (now - (rec.ts ?? 0) < SHADOW_TTL) this.shadows.set(id, rec)
    }
  }

  /** remember a channel Slack can't see, so it renders and autocompletes */
  private confirm(id: string, rec: ShadowRecord) {
    this.index.set(id, rec)
    this.shadows.set(id, { ...rec, ts: Date.now() })
  }

  /** re-inject after a shadow changed, and persist the snapshot (debounced) */
  private commit() {
    this.api.redux.refresh()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      const index: Record<string, ShadowRecord> = {}
      for (const [id, rec] of this.index) index[id] = rec
      const confirmed: Record<string, Confirmed> = {}
      for (const [id, rec] of this.shadows) confirmed[id] = rec
      void this.api.storage.set<Snapshot>('channels', {
        ts: this.exportTs,
        index,
        confirmed,
      })
    }, 1000)
  }

  private async loadExport() {
    const res = await fetch(`${FLARON}/admin/export`, {
      headers: { 'x-admin-key': this.adminKey },
      signal: this.api.signal,
    })
    if (!res.ok) throw new Error(`export ${res.status}`)
    const data = (await res.json()) as Record<string, ExportEntry>
    if (this.api.signal.aborted) return
    for (const [id, entry] of Object.entries(data)) {
      const name = entry?.latest
      // flaron marks public channels private too, so this doesn't do much...
      // sahil fix it please :3
      if (!name || entry.private !== true) continue
      const previousNames = (entry.history ?? [])
        .map((h) => h?.name)
        .filter((n): n is string => !!n && n !== name)
      this.index.set(id, { name, previousNames })
    }
    this.exportTs = Date.now()
    this.commit()
    this.log(`indexed ${this.index.size} channel names`)
  }

  /** flaron's record for a channel id */
  private async fetchFlaron(
    id: string
  ): Promise<{ ok: boolean; name?: string; isPublic?: boolean }> {
    try {
      const res = await fetch(`${FLARON}/cid/${id}`, {
        signal: this.api.signal,
      })
      if (this.api.signal.aborted) return { ok: false }
      // flaron has no record of it
      if (!res.ok) return { ok: true }
      const data = (await res.json()) as { name?: string; created?: number }
      // public channels come back with full metadata, private ones {id, name}
      if ('created' in data) {
        this.index.delete(id)
        return { ok: true, isPublic: true }
      }
      return { ok: true, name: data.name }
    } catch {
      return { ok: false }
    }
  }

  /** shadow ids Slack itself failed to resolve, naming them from flaron */
  private onMissing(ids: string[]) {
    const lookups: string[] = []
    let added = false
    for (const id of ids) {
      if (typeof id !== 'string' || this.shadows.has(id)) continue
      const rec = this.index.get(id)
      if (rec) {
        this.confirm(id, rec)
        added = true
      } else {
        lookups.push(id)
      }
    }
    if (added) this.commit()
    for (const id of lookups) void this.resolveById(id)
  }

  /** name a channel Slack couldn't resolve, falling back to its bare id */
  private async resolveById(id: string) {
    if (this.resolved.has(id)) return
    this.resolved.add(id)
    const found = await this.fetchFlaron(id)
    if (!found.ok || found.isPublic || this.api.signal.aborted) return
    this.confirm(id, { name: found.name || id })
    this.commit()
  }

  /** shadow an indexed channel, once flaron confirms Slack can't reach it */
  private async verifyById(id: string): Promise<boolean> {
    if (this.shadows.has(id) || this.resolved.has(id)) return false
    this.resolved.add(id)
    const found = await this.fetchFlaron(id)
    if (!found.ok || found.isPublic || !found.name || this.api.signal.aborted)
      return false
    this.confirm(id, {
      name: found.name,
      previousNames: this.index.get(id)?.previousNames,
    })
    return true
  }

  /** indexed channels matching `query` that Slack has nothing for, best first */
  private candidatesFor(query: string): string[] {
    if (query.length < 2) return []
    const rank = (name: string) =>
      name === query
        ? 0
        : name.startsWith(query)
          ? 1
          : name.includes(query)
            ? 2
            : 3
    const tiers: Array<Array<{ id: string; name: string }>> = [[], [], []]
    for (const [id, rec] of this.index) {
      if (this.shadows.has(id) || this.resolved.has(id)) continue
      // Slack can already find it, so its own searcher covers it
      const cached = this.api.channels.getCachedChannel(id)
      if (cached?.name && !this.synthesized.has(cached)) continue
      let best = 3
      for (const name of [rec.name, ...(rec.previousNames ?? [])])
        best = Math.min(best, rank(name.toLowerCase()))
      if (best < 3) tiers[best].push({ id, name: rec.name })
    }
    return tiers
      .flatMap((tier) => tier.sort((a, b) => a.name.length - b.name.length))
      .slice(0, MAX_QUERY_LOOKUPS)
      .map((c) => c.id)
  }

  /** shadow whatever flaron has for `query` that Slack couldn't find */
  private async resolveByName(query: string): Promise<boolean> {
    const name = query.trim().toLowerCase()
    if (!name) return false
    const candidates = this.candidatesFor(name)
    if (candidates.length) {
      const found = await Promise.all(
        candidates.map((id) => this.verifyById(id))
      )
      if (found.some(Boolean)) {
        this.commit()
        return true
      }
    }
    return this.lookupName(name)
  }

  /** resolve a complete channel name -> id from flaron and save it as a shadow */
  private async lookupName(name: string): Promise<boolean> {
    if (this.resolvedNames.has(name)) return false
    this.resolvedNames.add(name)
    try {
      const res = await fetch(`${FLARON}/cname/${encodeURIComponent(name)}`, {
        signal: this.api.signal,
      })
      if (!res.ok) return false
      const data = (await res.json()) as {
        id?: string
        name?: string
        created?: number
      }
      // public channels come back with full metadata, leave those to Slack
      if (
        this.api.signal.aborted ||
        !data?.id ||
        !data.name ||
        'created' in data
      )
        return false
      this.confirm(data.id, { name: data.name })
      this.commit()
      return true
    } catch {
      return false
    }
  }

  private patchThunks() {
    this.api.redux.patchThunk(
      'fetchRawChannelsById',
      (original) => (params) => {
        const thunk = original(params)
        return (...args: unknown[]) =>
          Promise.resolve(thunk(...args)).then((res) => {
            const missing = (res as { missing?: string[] })?.missing
            if (Array.isArray(missing)) this.onMissing(missing)
            return res
          })
      }
    )

    this.api.redux.patchThunk(
      'autocompleteChannels',
      (original) => (params) => {
        // the composer passes the typed text, sigil and all
        const q =
          typeof params?.query === 'string'
            ? params.query.trim().replace(/^#/, '').toLowerCase()
            : ''
        if (!q) return original(params)
        return (...args: unknown[]) => {
          const result = original(params)(...args)
          return Promise.resolve(result).then((local) => {
            // Slack's local tier, has a .promise to the remote tier
            if (!Array.isArray(local)) return local
            // Slack's remote tier (includes local too)
            const slackRemote: unknown = (local as { promise?: unknown })
              .promise

            const merged = Promise.resolve(slackRemote).then(async (remote) => {
              const base = Array.isArray(remote) ? remote : local
              // if Slack found an exact match, don't bother looking up flaron
              const covered = base.some((r) => {
                const name = r?.item?.name || r?.name
                return typeof name === 'string' && name.toLowerCase() === q
              })
              if (covered) return base
              // let's check and add flaron shadows
              const added = await this.resolveByName(q)
              if (!added) return base // still no exact match, resolve
              // we just added to the store, so re-run the original thunk to let slack's logic find it
              const rerun = await original(params)(...args)
              // (but no need to await its remote tier, the first run put it in the store)
              return Array.isArray(rerun)
                ? this.mergeChannelResults(base, rerun)
                : base
            })

            // sometimes local is a frozen empty array for some reason, so clone it
            const fresh = local.slice() as unknown[] & { promise?: unknown }
            fresh.promise = merged
            return fresh
          })
        }
      }
    )
  }

  /** union two result lists, deduped by channel id (base entries win) */
  private mergeChannelResults(
    base: Array<{ item?: { id?: string }; id?: string }>,
    extra: Array<{ item?: { id?: string }; id?: string }>
  ) {
    const seen = new Set<string>()
    for (const r of base) {
      const id = r?.item?.id ?? r?.id
      if (id) seen.add(id)
    }
    const out = [...base]
    for (const r of extra) {
      const id = r?.item?.id ?? r?.id
      if (id && !seen.has(id)) {
        seen.add(id)
        out.push(r)
      }
    }
    return out
  }

  /** a grayed-out channel mention that shows a name/id */
  private renderMissing(name: string) {
    const SvgIcon = this.api.elements.SvgIcon
    return (
      <span className="c-missing_channel--private">
        <SvgIcon inline={true} name="lock" />
        {name}
      </span>
    )
  }

  private patchChannelRendering() {
    this.api.patchComponent<{
      id?: string
      channelName?: string
      isPrivate?: boolean
      isMember?: boolean
      isNonExistent?: boolean
      isUnknown?: boolean
    }>('BaseMrkdwnChannel', (Original) => (props) => {
      const inaccessible =
        props.isNonExistent ||
        props.isUnknown ||
        (props.isPrivate && !props.isMember)
      if (inaccessible && props.id)
        return this.renderMissing(props.channelName || props.id)

      return <Original {...props} />
    })

    this.api.patchComponent<{ id?: string }>(
      'ListChannelEntity',
      (Original) => (props) => {
        const id = props.id
        const channel = this.api.redux.useReduxState<
          | {
              name?: string
              is_private?: boolean
              is_member?: boolean
              isNonExistent?: boolean
              isUnknown?: boolean
            }
          | undefined
        >((s) => (id ? s.channels?.[id] : undefined))
        const inaccessible =
          !!channel &&
          (channel.isNonExistent ||
            channel.isUnknown ||
            (channel.is_private && !channel.is_member))
        if (inaccessible && id) return this.renderMissing(channel?.name || id)

        return <Original {...props} />
      }
    )
  }
}
