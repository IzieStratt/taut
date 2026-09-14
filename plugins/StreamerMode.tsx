// Blurs private information while others may be able to see your screen

import { opt, TautPlugin } from '$taut'

type Shortcut = {
  code: string
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

type NotificationArgs = { message?: unknown }
type MessageProps = { msg?: { channel?: string }; className?: string }

const ROOT_CLASS = 'taut-streamer-mode'
const THREAD_CLASS = 'taut-streamer-mode__private-thread'
const REVEAL_CLASS = 'taut-streamer-mode__revealed'
const THREADS_VIEW = '.p-threads_view'
const LIST_ITEM = '.c-virtual_list__item'
const SHARED_KEY = 'active'
const STORAGE_KEY = 'taut_streamer_mode_active'
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

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

/** the thread a row belongs to, from the key its list item carries */
function threadOf(row: Element): string {
  const key = row.getAttribute('data-item-key') ?? ''
  const [channel, ts] = key.replace(/^(?:heading|root|footer)-/, '').split('-')
  return ts ? `${channel}-${ts}` : ''
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

export default class StreamerMode extends TautPlugin<typeof StreamerMode> {
  static readonly id = 'StreamerMode'
  static readonly pluginName = 'Streamer Mode'
  static readonly description =
    'Blurs private information while others may be able to see your screen'
  static readonly authors = '<@U06UYA5GMB5>, <@U080A3QP42C>, <@U07VC9705D4>'
  static readonly defaultConfig = {
    enabled: false,
    blur: opt(4, "4px shows the shape but isn't readable"),
    shortcut: opt(
      'mod+shift+p',
      '"" for off, "mod" is Ctrl (Cmd on mac), and a modifier is required'
    ),
    hideVip: true,
    silenceNotifications: true,
    autoOnScreenShare: true,
  }

  private get options() {
    const { blur, shortcut } = this.config
    return {
      ...this.config,
      blur: typeof blur === 'number' && blur > 0 ? blur : 4,
      shortcut: typeof shortcut === 'string' ? shortcut : '',
    }
  }

  private active = new this.api.SharedStore<boolean>(
    SHARED_KEY,
    localStorage.getItem(STORAGE_KEY) === 'true'
  )
  /** a screen share turned it on, so the share ending turns it off */
  private autoActivated = false
  private originalGetDisplayMedia: MediaDevices['getDisplayMedia'] | null = null

  start() {
    this.apply(this.active.get())
    this.api.setStyle(this.css(), 'streamer')
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

    this.markPrivateThreads()
    this.followThreadHover()
    if (this.options.autoOnScreenShare) this.watchScreenShares()
    this.log('Started')
  }

  stop() {
    document.documentElement.classList.remove(ROOT_CLASS)
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

  private markPrivateThreads() {
    this.api.patchComponent<MessageProps>(
      'MessageBackground',
      (Original) => (props) => {
        const id = props.msg?.channel
        const channel = id ? this.api.channels.getCachedChannel(id) : undefined
        if (!channel?.is_private && !channel?.is_mpim)
          return <Original {...props} />
        return (
          <Original
            {...props}
            className={`${props.className ?? ''} ${THREAD_CLASS}`}
          />
        )
      }
    )
  }

  private revealed = ''

  // A thread's heading, root, replies and footer are flat siblings, so we need js
  private followThreadHover() {
    const follow = (event: Event) => {
      const view = document.querySelector(THREADS_VIEW)
      if (!view) return
      const target = event.target
      const row =
        target instanceof Element ? target.closest(LIST_ITEM) : undefined
      const thread = row && view.contains(row) ? threadOf(row) : ''
      if (thread === this.revealed) return
      this.revealed = thread
      for (const item of Array.from(view.querySelectorAll(LIST_ITEM)))
        item.classList.toggle(
          REVEAL_CLASS,
          !!thread && threadOf(item) === thread
        )
    }
    for (const type of ['pointerover', 'focusin'] as const)
      window.addEventListener(type, follow, true)
    this.api.signal.addEventListener('abort', () => {
      for (const type of ['pointerover', 'focusin'] as const)
        window.removeEventListener(type, follow, true)
    })
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

  private css(): string {
    const root = `html.${ROOT_CLASS}`
    const { blur, hideVip } = this.options
    const lock = '[data-inline-channel-type-icon^="lock"]'
    const sidebarRow =
      '.p-channel_sidebar__channel:is([data-qa-channel-sidebar-channel-type="private"], [data-qa-channel-sidebar-channel-type="mpim"]):not([data-qa-channel-sidebar-channel-is-selected="true"])'
    const activityRow = '[data-qa="activity-item-container"]'
    const preview = '[data-qa="activity-item-message"]'

    const destination = '.p-activity_row_content__destination_tag'

    const privateDestination = `${destination}:has(${lock})`
    const groupDestination = `${destination}:not(:has(.c-inline_channel_entity))`

    const dmsRow =
      '[data-qa="dms_channel"]:not(:has(.p-activity_ia4_page__item--selected))'
    const groupName = `${dmsRow}:has(.c-base_icon_image_stacked) [data-qa="dms-channel-sender-name"]`

    const threadBody = `.${THREAD_CLASS} :is(.c-message_kit__gutter__left, .c-message_kit__gutter__right)`
    const suggestion =
      '.c-search_autocomplete__suggestion_item:is(:has(.c-channel_icon svg[data-qa^="lock"]), [data-type="mpim"])'
    const suggestionText = '.c-search_autocomplete__suggestion_item_left'

    const mention = `.c-inline_channel_entity:has(${lock}):not(${activityRow} *) .c-channel_entity__name`

    const inRow = `:is(${preview}, ${destination}, [data-qa="dms-channel-sender-name"])`
    return `
      ${root} ${sidebarRow} .p-channel_sidebar__name,
      ${root} ${mention},
      ${root} ${activityRow} :is(${privateDestination}, ${groupDestination}),
      ${root} ${activityRow}:has(${lock}) ${preview},
      ${root} ${activityRow}:has([data-qa="direct-messages"]) ${preview},
      ${root} ${dmsRow} ${preview},
      ${root} ${groupName},
      ${root} .p-threads_view ${threadBody},
      ${root} ${suggestion} ${suggestionText} {
        filter: blur(${blur}px);
        transition: filter 0.15s;
      }
      ${root} .p-channel_sidebar:hover ${sidebarRow} .p-channel_sidebar__name,
      ${root} .c-inline_channel_entity:hover .c-channel_entity__name,
      ${root} ${activityRow}:hover ${inRow},
      ${root} ${dmsRow}:hover ${inRow},
      ${root} .${REVEAL_CLASS} ${threadBody},
      ${root} .${REVEAL_CLASS} ${mention},
      ${root} ${suggestion}:hover ${suggestionText} {
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
