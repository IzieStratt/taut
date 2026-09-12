// Reads and edits Slack message objects, and works out which bot sent one

import {
  getPatchVersion,
  getRawState,
  mapEntries,
  patchSlice,
  reduxPromise,
} from './redux'
import { waitForExport } from './webpack'

export type SlackBotIcons = {
  image_36?: string
  image_48?: string
  image_72?: string
  emoji?: string
}

export type SlackBot = {
  id?: string
  name?: string
  app_id?: string
  user_id?: string
  deleted?: boolean
  icons?: SlackBotIcons
  [key: string]: unknown
}

export type SlackMessage = {
  channel?: string
  ts?: string
  user?: string
  bot_id?: string
  app_id?: string
  username?: string
  icons?: SlackBotIcons
  bot_profile?: SlackBot
  subtype?: string
  attachments?: SlackAttachment[]
  [key: string]: unknown
}

/** one row of the activity feed */
export type SlackActivityItem = {
  type?: string
  channelId?: string
  messageTs?: string
  [key: string]: unknown
}

/** forwarded message data */
export type SlackAttachment = {
  author_id?: string
  author_name?: string
  /** the name the forwarded message was posted under, when it overrode one */
  author_subname?: string
  author_icon?: string
  author_link?: string
  channel_id?: string
  ts?: string
  [key: string]: unknown
}

export const getMessageBotId = (
  msg: SlackMessage | undefined
): string | undefined =>
  msg?.bot_id ??
  msg?.bot_profile?.id ??
  (msg?.taut_bot_id as string | undefined)

export function getRawMessage(
  channel: string,
  ts: string
): SlackMessage | undefined {
  return getRawState()?.messages?.[channel]?.[ts]
}

/** the original stored version of a rendered message, before Taut's patches */
export const asRawMessage = (
  msg: SlackMessage | undefined
): SlackMessage | undefined =>
  (typeof msg?.channel === 'string' &&
    msg.ts &&
    getRawMessage(msg.channel, msg.ts)) ||
  msg

/** return a copy of the `message` object with the given fields replaced */
export function modifyMessageObject(
  message: SlackMessage,
  edits: {
    /** credit the message to this member, dropping every trace of the bot, except taut_bot_id */
    sentBy?: string
  }
): SlackMessage {
  const next: SlackMessage = { ...message }
  if (edits.sentBy === undefined) return next

  next.user = edits.sentBy
  const bot = getMessageBotId(message)
  if (bot) next.taut_bot_id = bot
  // Slack tests some of these with `in`, so delete rather than blank them
  for (const key of [
    'bot_id',
    'app_id',
    'username',
    'icons',
    'bot_profile',
    'display_as_bot',
  ] as const)
    delete next[key]
  if (next.subtype === 'bot_message') delete next.subtype
  return next
}

type HistorySlice = {
  timestamps?: string[]
  start?: string
  end?: string
}
type ChannelHistory = {
  slices?: HistorySlice[]
  /** whether the oldest slice includes the conversation's first message */
  reachedStart?: boolean
  /** whether the newest slice includes the latest message */
  reachedEnd?: boolean
}

const historyKeyChannel = (key: string): string => key.split('-')[0]
const historyKeyThread = (key: string): string | undefined =>
  key.includes('-') ? key.slice(key.indexOf('-') + 1) : undefined

function inHistory(msg: SlackMessage, thread: string | undefined): boolean {
  const parent = typeof msg.thread_ts === 'string' ? msg.thread_ts : undefined
  if (thread !== undefined) return parent === thread
  // in the channel itself a reply only shows when it was also broadcast
  return (
    parent === undefined ||
    parent === msg.ts ||
    msg.subtype === 'thread_broadcast'
  )
}

function withTimestamps(
  history: ChannelHistory,
  added: string[]
): HistorySlice[] {
  const slices = history.slices ?? []
  const last = slices.length - 1
  let changed = false
  const next = slices.map((slice, position) => {
    const { timestamps, start, end } = slice
    if (!Array.isArray(timestamps)) return slice
    const covers = (ts: string) =>
      (start === undefined ||
        ts >= start ||
        (position === 0 && history.reachedStart === true)) &&
      (end === undefined ||
        ts <= end ||
        (position === last && history.reachedEnd === true))
    const missing = added.filter((ts) => covers(ts) && !timestamps.includes(ts))
    if (!missing.length) return slice
    changed = true
    // slack timestamps are fixed-width, so they sort as plain strings
    return { ...slice, timestamps: [...timestamps, ...missing].sort() }
  })
  return changed ? next : slices
}

export function injectMessages(
  getMessages: () => Iterable<SlackMessage>
): () => void {
  let indexedAt = -1
  let byChannel = new Map<string, Map<string, SlackMessage>>()

  const index = () => {
    if (indexedAt === getPatchVersion()) return byChannel
    indexedAt = getPatchVersion()
    byChannel = new Map()
    for (const msg of getMessages()) {
      if (typeof msg?.channel !== 'string' || typeof msg.ts !== 'string')
        continue
      let bucket = byChannel.get(msg.channel)
      if (!bucket) {
        bucket = new Map()
        byChannel.set(msg.channel, bucket)
      }
      bucket.set(msg.ts, msg)
    }
    return byChannel
  }

  const unpatchMessages = patchSlice<object>(
    'messages',
    (channel, bucket) => {
      const injected = index().get(channel)
      if (!injected?.size) return bucket
      return mapEntries<SlackMessage>(
        bucket ?? {},
        (ts, msg) => injected.get(ts) ?? msg,
        () => injected.keys()
      )
    },
    () => index().keys()
  )

  const unpatchHistory = patchSlice<ChannelHistory>(
    'channelHistory',
    (key, entry) => {
      const slices = entry?.slices
      if (!entry || !Array.isArray(slices)) return entry
      const injected = index().get(historyKeyChannel(key))
      if (!injected?.size) return entry
      const thread = historyKeyThread(key)
      const added = [...injected.values()]
        .filter((msg) => inHistory(msg, thread))
        .map((msg) => msg.ts as string)
      if (!added.length) return entry
      const next = withTimestamps(entry, added)
      return next === slices ? entry : { ...entry, slices: next }
    }
  )

  return () => {
    unpatchMessages()
    unpatchHistory()
  }
}

type SenderDetails = (
  state: any,
  item: SlackActivityItem | undefined
) => { senderType?: string; senderId?: string } | undefined

export const messagesPromise = (async () => {
  const { useReduxState } = await reduxPromise
  // the activity view is a lazy chunk
  let readSender: SenderDetails | undefined
  void waitForExport<SenderDetails>(
    (e: any) =>
      typeof e === 'function' && e.name === 'getSenderDetailsFromActivityItem'
  ).then((found) => {
    readSender = found
  })

  function useActivityMessage(
    item: SlackActivityItem | undefined
  ): SlackMessage | undefined {
    const drawn = useReduxState<string | undefined>((state) => {
      const sender = readSender?.(state, item)
      return sender?.senderType === 'app' ? undefined : sender?.senderId
    })
    const msg =
      item?.channelId && item.messageTs
        ? getRawMessage(item.channelId, item.messageTs)
        : undefined
    return msg && { ...msg, user: drawn }
  }

  function useMessageBot(msg: SlackMessage | undefined): SlackBot | undefined {
    const botId = useReduxState(() => getMessageBotId(asRawMessage(msg)))
    const stored = useReduxState<SlackBot | undefined>((state) =>
      botId ? state.bots?.[botId] : undefined
    )
    if (!botId) return undefined
    return stored ?? asRawMessage(msg)?.bot_profile ?? { id: botId }
  }

  return {
    getRawMessage,
    asRawMessage,
    getMessageBotId,
    injectMessages,
    modifyMessageObject,
    useActivityMessage,
    useMessageBot,
  }
})()

export type MessagesAPI = Awaited<typeof messagesPromise>
