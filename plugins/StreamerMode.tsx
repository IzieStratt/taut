// Blurs private information while others may be able to see your screen

import { TautPlugin, type TautPluginConfig } from '$taut'

type StreamerModeConfig = TautPluginConfig & {
  blur: number
  shortcut: string
  hideVip: boolean
  silenceNotifications: boolean
  autoOnScreenShare: boolean
}

type Shortcut = {
  code: string
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

type NotificationArgs = { message?: unknown }

const ROOT_CLASS = 'taut-streamer-mode'
const SHARED_KEY = 'active'
const STORAGE_KEY = 'taut_streamer_mode_active'
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)
const CHANNEL_ID = /^[CDG][A-Z0-9]{5,}$/

function parseShortcut(value: unknown): Shortcut | null {
  if (typeof value !== 'string') return null
  const parts = value
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
  const key = parts.pop()
  if (!key) return null
  const mods = new Set(parts)
  const shortcut = {
    code: /^[a-z]$/.test(key)
      ? `Key${key.toUpperCase()}`
      : /^[0-9]$/.test(key)
        ? `Digit${key}`
        : key,
    key,
    mod: mods.has('mod') || mods.has('cmd') || mods.has('ctrl'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
  }
  // without one of these it would fire while someone is typing
  return shortcut.mod || shortcut.alt ? shortcut : null
}

function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const mod = IS_MAC ? event.metaKey : event.ctrlKey
  return (
    (event.code === shortcut.code ||
      event.key.toLowerCase() === shortcut.key) &&
    mod === shortcut.mod &&
    event.shiftKey === shortcut.shift &&
    event.altKey === shortcut.alt
  )
}

export default class StreamerMode extends TautPlugin {
  static readonly id = 'StreamerMode'
  static readonly pluginName = 'Streamer Mode'
  static readonly description =
    'Blurs private information while others may be able to see your screen'
  static readonly authors = '<@U06UYA5GMB5>, <@U080A3QP42C>, <@U07VC9705D4>'
  static readonly defaultConfig = `
    // Blurs private information while others may be able to see your screen
    "StreamerMode": {
      "enabled": false,
      // 4px shows the shape but isn't readable
      "blur": 4,
      // "" for off, "mod" is Ctrl (Cmd on mac), and a modifier is required
      "shortcut": "mod+shift+p",
      "hideVip": true,
      "silenceNotifications": true,
      "autoOnScreenShare": true
    }
  `

  private get options(): StreamerModeConfig {
    const config = this.config as Partial<StreamerModeConfig>
    return {
      ...config,
      blur:
        typeof config.blur === 'number' && config.blur > 0 ? config.blur : 4,
      shortcut: typeof config.shortcut === 'string' ? config.shortcut : '',
      hideVip: config.hideVip !== false,
      silenceNotifications: config.silenceNotifications !== false,
      autoOnScreenShare: config.autoOnScreenShare !== false,
    } as StreamerModeConfig
  }

  private active = new this.api.SharedStore<boolean>(
    SHARED_KEY,
    localStorage.getItem(STORAGE_KEY) === 'true'
  )
  /** a screen share turned it on, so the share ending turns it off */
  private autoActivated = false
  private originalGetDisplayMedia: MediaDevices['getDisplayMedia'] | null = null
  private restyling: number | null = null
  private styleKey = ''

  start() {
    this.apply(this.active.get())
    this.restyle()
    this.injectButton()

    if (this.options.silenceNotifications) {
      this.api.redux.patchThunk(
        'showNotification',
        (original) => (args: NotificationArgs) =>
          original(this.active.get() ? { ...args, message: undefined } : args)
      )
    }

    const shortcut = parseShortcut(this.options.shortcut)
    if (shortcut) {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.repeat || !matches(event, shortcut)) return
        event.preventDefault()
        event.stopPropagation()
        this.toggle()
      }
      window.addEventListener('keydown', onKeyDown, true)
      this.api.signal.addEventListener('abort', () =>
        window.removeEventListener('keydown', onKeyDown, true)
      )
    } else if (this.options.shortcut) {
      this.log(
        `Ignoring "${this.options.shortcut}", a shortcut needs Ctrl, Cmd or Alt`
      )
    }

    if (this.options.autoOnScreenShare) this.watchScreenShares()
    this.api.redux.subscribe(this.onStoreChange)
    this.log('Started')
  }

  stop() {
    document.documentElement.classList.remove(ROOT_CLASS)
    if (this.restyling !== null) cancelAnimationFrame(this.restyling)
    this.restyling = null
    if (this.originalGetDisplayMedia) {
      navigator.mediaDevices.getDisplayMedia = this.originalGetDisplayMedia
      this.originalGetDisplayMedia = null
    }
  }

  private toggle = () => {
    this.autoActivated = false
    this.apply(!this.active.get())
    localStorage.setItem(STORAGE_KEY, String(this.active.get()))
  }

  private apply(active: boolean) {
    this.active.set(active)
    document.documentElement.classList.toggle(ROOT_CLASS, active)
  }

  private onStoreChange = () => {
    this.restyling ??= requestAnimationFrame(() => {
      this.restyling = null
      this.restyle()
    })
  }

  private restyle() {
    const state = this.api.redux.getRawState()
    const entity = state?.route?.params?.entityId
    const open =
      typeof entity === 'string' && CHANNEL_ID.test(entity) ? entity : ''
    const ids: string[] = []
    for (const id in state?.channels ?? {})
      if (state.channels[id]?.is_private === true) ids.push(id)
    ids.sort()

    const key = `${open}|${ids.join()}`
    if (key === this.styleKey) return
    this.styleKey = key
    this.api.setStyle(this.css(open, ids), 'streamer')
  }

  private watchScreenShares() {
    const media = navigator.mediaDevices
    if (typeof media?.getDisplayMedia !== 'function') return
    const original = media.getDisplayMedia.bind(media)
    this.originalGetDisplayMedia = media.getDisplayMedia
    const shares = new Set<MediaStream>()
    const ended = (stream: MediaStream) => {
      shares.delete(stream)
      if (shares.size || !this.autoActivated) return
      this.autoActivated = false
      this.apply(false)
    }
    media.getDisplayMedia = async (...args) => {
      const stream = await original(...args)
      if (this.api.signal.aborted) return stream
      shares.add(stream)
      if (!this.active.get()) {
        this.autoActivated = true
        this.apply(true)
      }
      for (const track of stream.getTracks())
        track.addEventListener('ended', () => ended(stream), { once: true })
      stream.addEventListener('inactive', () => ended(stream), { once: true })
      return stream
    }
  }

  private injectButton() {
    const { Tooltip, SvgIcon } = this.api.elements
    const KeyboardKeysTooltip = this.api.lazyComponent<{
      title: string
      mainKey: string
      modifiers?: string[]
    }>('KeyboardKeysTooltip')
    const shortcut = parseShortcut(this.options.shortcut)
    const modifiers = shortcut && [
      ...(shortcut.mod ? [IS_MAC ? '⌘' : 'Ctrl'] : []),
      ...(shortcut.alt ? [IS_MAC ? 'Option' : 'Alt'] : []),
      ...(shortcut.shift ? ['Shift'] : []),
    ]
    const label = (active: boolean) =>
      active ? 'Turn off streamer mode' : 'Turn on streamer mode'
    const tip = (active: boolean) =>
      shortcut ? (
        <KeyboardKeysTooltip
          title={label(active)}
          modifiers={modifiers ?? undefined}
          mainKey={shortcut.key.toUpperCase()}
        />
      ) : (
        label(active)
      )

    this.api.patchComponent<Record<string, unknown>>(
      'HelpButton',
      (Original) => (props) => {
        const active = this.active.use()
        return (
          <>
            <div className="p-top_nav__windows_controls_container taut-streamer-mode__container">
              <Tooltip tip={tip(active)} position="bottom" delay={500}>
                <button
                  type="button"
                  className="c-button-unstyled p-top_nav__button p-top_nav__help taut-streamer-mode__button"
                  aria-label={label(active)}
                  aria-pressed={active}
                  onClick={this.toggle}
                >
                  <SvgIcon
                    name={active ? 'eye-closed' : 'eye-open'}
                    size={20}
                  />
                </button>
              </Tooltip>
            </div>
            <Original {...props} />
          </>
        )
      }
    )
  }

  private css(open: string, privateIds: string[]): string {
    const root = `html.${ROOT_CLASS}`
    const { blur, hideVip } = this.options
    const sidebarRow = `.p-channel_sidebar__channel[data-qa-channel-sidebar-channel-type="private"]:not(.p-channel_sidebar__channel--selected)`
    const entity = `.c-inline_channel_entity:has([data-inline-channel-type-icon^="lock"])${
      open ? `:not([data-channel-id="${open}"])` : ''
    }`
    const activityItem = `[data-qa="activity-item-container"]`
    const preview = `[data-qa="activity-item-message"]`

    const threadRows = privateIds
      .filter((id) => id !== open)
      .map((id) => `[data-item-key*="${id}"]`)
    const suggestions = privateIds
      .filter((id) => id !== open)
      .map((id) => `[data-id="${id}"]`)
    const threadRow = threadRows.length
      ? `.c-virtual_list__item:is(${threadRows.join(', ')}) :is(.c-message_kit__gutter__left, .c-message_kit__gutter__right)`
      : ''
    const suggestion = suggestions.length
      ? `.c-search_autocomplete__suggestion_item:is(${suggestions.join(', ')})`
      : ''
    const suggestionText = '.c-search_autocomplete__suggestion_item_left'
    const blurred = [
      `${root} ${sidebarRow} .p-channel_sidebar__name`,
      `${root} ${entity} .c-channel_entity__name`,
      `${root} ${activityItem}:has([data-inline-channel-type-icon^="lock"]) ${preview}`,
      `${root} ${activityItem}:has([data-qa="direct-messages"]) ${preview}`,
      `${root} [data-qa="dms_channel"] ${preview}`,
      ...(threadRow ? [`${root} .p-threads_view ${threadRow}`] : []),
      ...(suggestion ? [`${root} ${suggestion} ${suggestionText}`] : []),
    ]
    const revealed = [
      `${root} .p-channel_sidebar:hover ${sidebarRow} .p-channel_sidebar__name`,
      `${root} ${entity}:hover .c-channel_entity__name`,
      `${root} ${activityItem}:hover ${preview}`,
      `${root} [data-qa="dms_channel"]:hover ${preview}`,
      ...(threadRow ? [`${root} .p-threads_view:hover ${threadRow}`] : []),
      ...(suggestion ? [`${root} ${suggestion}:hover ${suggestionText}`] : []),
    ]
    return `
      ${blurred.join(',\n      ')} {
        filter: blur(${blur}px);
        transition: filter 0.15s;
      }
      ${revealed.join(',\n      ')} {
        filter: none;
      }
      ${
        hideVip
          ? `${root} [data-qa="priority_vip_badge"],
      ${root} svg[data-qa="vip"],
      ${root} svg[data-qa="vip-filled"] {
        display: none;
      }`
          : ''
      }
      .taut-streamer-mode__container {
        margin-right: 8px;
      }
      .taut-streamer-mode__button[aria-pressed="true"] {
        color: rgba(var(--sk_raspberry_red, 224, 30, 90), 1);
      }
    `
  }
}
