// Shows each person's local time beside their messages and on their profile, even while they're out of office

import { opt, TautPlugin } from '$taut'

type Message = { user?: string; bot_id?: string }
type BroadcastPreambleProps = { msg?: Message; children?: React.ReactNode }
type ThreadHeaderProps = {
  msg?: Message
  adjacent?: boolean
  visible?: boolean
  omitTimestamp?: boolean
  omitLinebreak?: boolean
}
type ProfileProps = { member?: { id?: string } }
type HoverCardProps = { memberId?: string }
type LocalTimeProps = { member?: { id?: string } }
type Surface = { userId?: string }

const USER_ID_RE = /^[UW][A-Z0-9]+$/
const MINUTE = 60_000

/** One timer for every mounted clock, so a screen of messages doesn't run a timer each. */
const listeners = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | undefined
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  ticker ??= setInterval(
    () =>
      listeners.forEach((notify) => {
        notify()
      }),
    MINUTE
  )
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker)
      ticker = undefined
    }
  }
}
const currentMinute = () => Math.floor(Date.now() / MINUTE)

const formatLocalTime = (
  tz: unknown,
  twelveHour: boolean,
  minute: number
): string => {
  if (typeof tz !== 'string' || !tz) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: twelveHour,
    }).format(minute * MINUTE)
  } catch {
    return ''
  }
}

const isPerson = (
  msg: Message | undefined
): msg is Message & { user: string } =>
  !!msg?.user &&
  USER_ID_RE.test(msg.user) &&
  msg.user !== 'USLACKBOT' &&
  !msg.bot_id

// grouped messages get the same children back with visible: false
const isHeaderChild = (child: React.ReactNode, prop: string): boolean => {
  const props = React.isValidElement(child) ? child.props : null
  if (typeof props !== 'object' || props === null) return false
  return prop in props && (props as { visible?: boolean }).visible !== false
}
const isTimestamp = (child: React.ReactNode) =>
  isHeaderChild(child, 'clickable')
// compact mode moves the timestamp to the left gutter, so sit after the sender
const isSender = (child: React.ReactNode) =>
  isHeaderChild(child, 'isInteractive')

export default class LocalTime extends TautPlugin<typeof LocalTime> {
  static readonly id = 'LocalTime'
  static readonly pluginName = 'Local Time'
  static readonly description =
    "Shows each person's local time beside their messages and on their profile, even while they're out of office"
  static readonly authors = [
    { name: 'izie', url: 'https://github.com/IzieStratt' },
  ] as const
  static readonly category = 'people'
  static readonly defaultConfig = {
    enabled: false,
    showInMessages: opt(
      true,
      'Shows the time after the sender, next to pronouns'
    ),
    showOnProfiles: opt(
      true,
      'Shows the time on profiles and hover cards, including while out of office'
    ),
    use12Hour: opt(true, 'Uses a 12-hour clock'),
  }

  private readonly Surface = React.createContext<Surface | undefined>(undefined)

  private readonly Clock = ({
    userId,
    className,
  }: {
    userId: string
    className: string
  }) => {
    const member = this.api.members.useMember(userId)
    const minute = React.useSyncExternalStore(subscribe, currentMinute, () => 0)
    const text = formatLocalTime(member?.tz, this.config.use12Hour, minute)
    if (!text) return null
    return (
      <span className={className} data-stringify-ignore="">
        {text}
      </span>
    )
  }

  private readonly CardLine = ({ userId }: { userId: string }) => {
    const member = this.api.members.useMember(userId)
    const minute = React.useSyncExternalStore(subscribe, currentMinute, () => 0)
    const text = formatLocalTime(member?.tz, this.config.use12Hour, minute)
    if (!text) return null
    return <span className="taut-local-time__card">{`Local time ${text}`}</span>
  }

  start() {
    this.api.setStyle(`
      .taut-local-time {
        margin-left: 6px;
        align-self: center;
        font-size: 12px;
        font-weight: 400;
        color: rgba(var(--sk_foreground_max_solid, 97, 96, 97), 1);
        white-space: nowrap;
        cursor: default;
        user-select: none;
      }

      .taut-local-time--bulleted {
        margin-left: 0;
      }

      .taut-local-time--bulleted::before {
        content: '\\2022';
        margin: 0 4px;
      }

      .taut-local-time__card {
        display: block;
        margin-top: 2px;
        font-size: 13px;
        color: rgba(var(--sk_foreground_high_solid, 134, 134, 134), 1);
      }
    `)

    if (this.config.showInMessages) this.patchMessages()
    if (this.config.showOnProfiles) this.patchProfiles()
    this.log('Started')
  }

  private patchMessages() {
    this.api.patchComponent<BroadcastPreambleProps>(
      'BaseBroadcastPreamble',
      (Original) => (props) => {
        if (!isPerson(props.msg)) return <Original {...props} />

        const children = React.Children.toArray(props.children)
        const timestamp = children.findIndex(isTimestamp)
        const anchor =
          timestamp === -1 ? children.findIndex(isSender) : timestamp
        if (anchor === -1) return <Original {...props} />

        children.splice(
          anchor + 1,
          0,
          <this.Clock
            key="taut-local-time"
            userId={props.msg.user}
            className={`taut-local-time${timestamp !== -1 ? ' taut-local-time--bulleted' : ''}`}
          />
        )
        return <Original {...props}>{children}</Original>
      }
    )

    this.api.patchComponent<ThreadHeaderProps>(
      'ThreadSenderAndTimestampGeneric',
      (Original) => (props) => {
        if (props.adjacent || props.visible === false || !isPerson(props.msg))
          return <Original {...props} />

        return (
          <>
            <Original {...props} omitLinebreak />
            <this.Clock
              userId={props.msg.user}
              className={`taut-local-time${props.omitTimestamp ? '' : ' taut-local-time--bulleted'}`}
            />
            {props.omitLinebreak ? null : <br />}
          </>
        )
      }
    )
  }

  private patchProfiles() {
    this.api.patchComponent<ProfileProps>(
      'RimetoProfilePresence',
      (Original) => (props) => {
        const userId = props.member?.id
        return (
          <>
            <this.Surface.Provider value={{ userId }}>
              <Original {...props} />
            </this.Surface.Provider>
            {userId ? <this.CardLine userId={userId} /> : null}
          </>
        )
      }
    )

    this.api.patchComponent<HoverCardProps>(
      'MemberProfileHoverCard',
      (Original) => (props) => {
        const userId = props.memberId
        return (
          <>
            <this.Surface.Provider value={{ userId }}>
              <Original {...props} />
            </this.Surface.Provider>
            {userId ? <this.CardLine userId={userId} /> : null}
          </>
        )
      }
    )

    // Slack's own line is hidden while out of office, and ours covers profiles either way
    this.api.patchComponent<LocalTimeProps>(
      'LocalTime',
      (Original) => (props) => {
        const surface = React.useContext(this.Surface)
        if (surface?.userId) return null
        return <Original {...props} />
      }
    )
  }
}
