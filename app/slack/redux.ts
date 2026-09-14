// Taut Redux Utilities
// Access to Slack's react-redux store, plus read-time state patching

import { getFiberFromNode, reactPromise } from './react'
import { patchExportFunction, patchModuleExports } from './webpack'

export type SlackStore = {
  getState(): any
  dispatch(action: any): any
  subscribe(cb: () => void): () => void
}

export type StatePatch = (state: any) => any
const statePatches = new Set<StatePatch>()
// Bumped on register/unregister to invalidate each store's getState memo
let statePatchVersion = 0

// Wrap a store's getState so reads flow through statePatches
function wrapGetState(store: SlackStore): void {
  if ((store.getState as any).__tautWrapped) return
  const realGetState = store.getState.bind(store)
  let cachedRaw: any
  let cachedVersion = -1
  let cachedOut: any
  const wrapped = () => {
    const raw = realGetState()
    if (statePatches.size === 0) return raw
    if (raw === cachedRaw && cachedVersion === statePatchVersion)
      return cachedOut
    let out = raw
    for (const patch of statePatches) {
      try {
        out = patch(out)
      } catch {}
    }
    cachedRaw = raw
    cachedVersion = statePatchVersion
    cachedOut = out
    return out
  }
  wrapped.__tautWrapped = true
  wrapped.__tautRawGetState = realGetState
  store.getState = wrapped
}

// Hook redux's createStore to wrap the getState of every store it creates
patchExportFunction('createStore', (originalCreateStore) => (...args) => {
  const store = originalCreateStore(...args)
  try {
    wrapGetState(store)
  } catch {}
  return store
})

let cachedStore: SlackStore | null = null

/** Slack's react-redux store, found via the <Provider> value on the fiber tree (cached) */
export function getReduxStore(): SlackStore | null {
  if (cachedStore) return cachedStore
  const start = document.querySelector('.p-client_container')?.firstElementChild
  if (!start) return null
  for (let fiber = getFiberFromNode(start); fiber; fiber = fiber.return) {
    const value = fiber.memoizedProps?.value
    const store = value?.store ?? value
    if (
      store &&
      typeof store.getState === 'function' &&
      typeof store.subscribe === 'function'
    ) {
      cachedStore = store
      return store
    }
  }
  return null
}

/** Slack's state as it is stored, with Taut's read-time transforms left off */
export function getRawState(): any {
  const getState = getReduxStore()?.getState as
    | ((() => any) & { __tautRawGetState?: () => any })
    | undefined
  return (getState?.__tautRawGetState ?? getState)?.()
}

const patchListeners = new Set<() => void>()

const subscribePatches = (notify: () => void) => {
  patchListeners.add(notify)
  return () => void patchListeners.delete(notify)
}
export const getPatchVersion = () => statePatchVersion

/** Invalidate patched reads and nudge connected views to re-read */
export function refreshState(): void {
  statePatchVersion++
  try {
    getReduxStore()?.dispatch({ type: '@@taut/PATCH_STATE' })
  } catch {}
  for (const notify of patchListeners) {
    try {
      notify()
    } catch {}
  }
}

/** Register a read-time state transform */
export function patchState(patch: StatePatch): () => void {
  statePatches.add(patch)
  refreshState()
  return () => {
    statePatches.delete(patch)
    refreshState()
  }
}

const hasOwn = (obj: object, key: PropertyKey): boolean =>
  typeof key !== 'symbol' && Object.hasOwn(obj, key)

export type MapEntry<T> = (key: string, entry: T | undefined) => T | undefined

type Memo = {
  cache: Map<string, { input: any; output: any }>
  added: Set<string>
  version: number
}

const memos = new WeakMap<MapEntry<any>, Memo>()
const memoFor = (mapEntry: MapEntry<any>): Memo => {
  let memo = memos.get(mapEntry)
  if (!memo) {
    memo = { cache: new Map(), added: new Set(), version: -1 }
    memos.set(mapEntry, memo)
  }
  return memo
}

/** A view of an id-keyed store object, reading entries through `mapEntry` */
export function mapEntries<T = any>(
  object: object,
  mapEntry: MapEntry<T>,
  addedKeys?: () => Iterable<string>
): object {
  const memo = memoFor(mapEntry)
  // A refresh (version bump) means the closure's inputs may have changed, so
  // memoized results and the added-key set are dropped and recomputed.
  const sync = () => {
    if (memo.version === statePatchVersion) return
    memo.cache = new Map()
    if (addedKeys) {
      try {
        memo.added = new Set(addedKeys())
      } catch {
        memo.added = new Set()
      }
    }
    memo.version = statePatchVersion
  }
  const run = (key: PropertyKey, value: any): any => {
    if (typeof key !== 'string') return value
    sync()
    const hit = memo.cache.get(key)
    if (hit && hit.input === value) return hit.output
    const output = mapEntry(key, value as T | undefined)
    memo.cache.set(key, { input: value, output })
    return output
  }
  const describe = (target: object, key: PropertyKey) => {
    const desc = Object.getOwnPropertyDescriptor(target, key)
    if (desc) {
      if (!('value' in desc) || desc.configurable === false) return desc
      return { ...desc, value: run(key, desc.value) }
    }
    sync()
    if (
      typeof key === 'string' &&
      memo.added.has(key) &&
      Object.isExtensible(target)
    )
      return {
        value: run(key, undefined),
        enumerable: true,
        configurable: true,
        writable: true,
      }
    return undefined
  }
  const ownKeysWith = (target: object): (string | symbol)[] => {
    const keys = Reflect.ownKeys(target)
    if (!addedKeys || !Object.isExtensible(target)) return keys
    sync()
    const extra = [...memo.added].filter((k) => !hasOwn(target, k))
    return extra.length ? [...keys, ...extra] : keys
  }
  const protoProxies = new WeakMap<object, object>()
  const proxyProto = (proto: object): object => {
    let proxied = protoProxies.get(proto)
    if (!proxied) {
      proxied = new Proxy(proto, {
        get: (target, key) => run(key, (target as any)[key]),
        getOwnPropertyDescriptor: describe,
        ownKeys: ownKeysWith,
      })
      protoProxies.set(proto, proxied)
    }
    return proxied
  }
  return new Proxy(object, {
    get: (target, key) => run(key, (target as any)[key]),
    getOwnPropertyDescriptor: (target, key) => {
      const desc = Object.getOwnPropertyDescriptor(target, key)
      if (!desc || !('value' in desc) || desc.configurable === false)
        return desc
      return { ...desc, value: run(key, desc.value) }
    },
    getPrototypeOf: (target) => {
      const proto = Object.getPrototypeOf(target)
      if (!proto || typeof proto !== 'object' || proto === Object.prototype)
        return proto
      return proxyProto(proto)
    },
  })
}

export function patchSlice<T = any>(
  sliceName: string,
  mapEntry: MapEntry<T>,
  addedKeys?: () => Iterable<string>
): () => void {
  return patchState((state) => {
    const slice = state?.[sliceName]
    if (!slice || typeof slice !== 'object') return state
    return { ...state, [sliceName]: mapEntries(slice, mapEntry, addedKeys) }
  })
}

type ThunkWrap = {
  match: (value: any) => boolean
  wrap: (original: (...args: any[]) => any) => (...args: any[]) => any
}
const thunkWraps = new Set<ThunkWrap>()

type ThunkCreator = (...args: any[]) => any

const thunkCreators = new Map<string, ThunkCreator>()
const waitingForThunk = new Map<string, Set<(creator: ThunkCreator) => void>>()

const wrapCreator = (original: ThunkCreator): ThunkCreator =>
  new Proxy(original, {
    apply(target, thisArg, args) {
      let creator: ThunkCreator = target
      for (const { match, wrap } of thunkWraps) {
        let matched = false
        try {
          matched = match(target)
        } catch {}
        if (!matched) continue
        try {
          creator = wrap(creator)
        } catch {}
      }
      return Reflect.apply(creator, thisArg, args)
    },
  })

function registerCreator(creator: ThunkCreator): void {
  // the defining module assigns `meta` on the statement after createThunk
  queueMicrotask(() => {
    // now that statement has run, the meta should be there
    const name = (creator as any).meta?.name
    if (typeof name !== 'string') return
    thunkCreators.set(name, creator)
    const waiting = waitingForThunk.get(name)
    if (!waiting) return
    waitingForThunk.delete(name)
    for (const resolve of waiting) resolve(creator)
  })
}

const readExport = (exports: any, key: string): any => {
  try {
    return exports[key]
  } catch {
    return undefined
  }
}
const isThunkKinds = (value: any): boolean =>
  value?.Thunk === 'Thunk' && value?.Fetcher === 'Fetcher'

// Every thunk and fetcher in the app uses createThunk
patchModuleExports((exports) => {
  if (!exports || typeof exports !== 'object') return
  const keys = Object.keys(exports)
  if (!keys.some((key) => isThunkKinds(readExport(exports, key)))) return
  const key = keys.find((candidate) => {
    const value = readExport(exports, candidate)
    return typeof value === 'function' && value.length === 2
  })
  if (!key) return

  const createThunk = exports[key] as (...args: any[]) => ThunkCreator
  const descriptors = Object.getOwnPropertyDescriptors(exports)
  descriptors[key] = {
    value: (...args: any[]) => {
      const creator = wrapCreator(createThunk(...args))
      registerCreator(creator)
      return creator
    },
    enumerable: true,
    configurable: true,
    writable: true,
  }
  return Object.create(Object.getPrototypeOf(exports), descriptors)
})

/** one of Slack's thunk creators, if it has been defined yet */
export function getThunkCreator(name: string): ThunkCreator | undefined {
  return thunkCreators.get(name)
}

/** one of Slack's thunk creators, resolving whenever Slack gets around to defining it */
export function waitForThunkCreator(name: string): Promise<ThunkCreator> {
  const known = thunkCreators.get(name)
  if (known) return Promise.resolve(known)
  return new Promise((resolve) => {
    let waiting = waitingForThunk.get(name)
    if (!waiting) {
      waiting = new Set()
      waitingForThunk.set(name, waiting)
    }
    waiting.add(resolve)
  })
}

export async function dispatchThunk<T = any>(
  name: string,
  ...args: any[]
): Promise<T> {
  const creator = await waitForThunkCreator(name)
  const store = getReduxStore()
  if (!store) throw new Error('[Taut] No redux store to dispatch to')
  return store.dispatch(creator(...args))
}

/** Observe or alter a Slack redux thunk */
export function patchThunk(
  match: string | ThunkWrap['match'],
  wrap: ThunkWrap['wrap']
): () => void {
  const matcher: ThunkWrap['match'] =
    typeof match === 'string' ? (v) => v?.meta?.name === match : match
  const entry: ThunkWrap = { match: matcher, wrap }
  thunkWraps.add(entry)
  return () => {
    thunkWraps.delete(entry)
  }
}

/** Reactively select from the store inside a React render */
export const reduxPromise = (async () => {
  const React = await reactPromise

  function useReduxState<T>(selector: (state: any) => T): T | undefined {
    const store = getReduxStore()
    const selectorRef = React.useRef(selector)
    selectorRef.current = selector
    const subscribe = React.useCallback(
      (cb: () => void) => (store ? store.subscribe(cb) : () => {}),
      [store]
    )
    const getSnapshot = React.useCallback(
      () => (store ? selectorRef.current(store.getState()) : undefined),
      [store]
    )
    return React.useSyncExternalStore(subscribe, getSnapshot)
  }

  // Slack's connect memoizes off the raw state, so it never re-runs for a
  // read-time patch. A component reading patched state needs this to re-render.
  function usePatchVersion(): number {
    return React.useSyncExternalStore(subscribePatches, getPatchVersion)
  }

  return {
    getStore: getReduxStore,
    getRawState,
    useReduxState,
    usePatchVersion,
    patchState,
    patchSlice,
    mapEntries,
    patchThunk,
    getThunkCreator,
    waitForThunkCreator,
    dispatchThunk,
    refresh: refreshState,
  }
})()

export type ReduxAPI = Awaited<typeof reduxPromise>
