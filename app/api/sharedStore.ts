// Reactive values a plugin publishes for other plugins to read

import { Store } from '../store'

export type SharedStoreHandle<T> = Pick<
  Store<T | undefined>,
  'get' | 'subscribe' | 'use'
>

const slots = new Map<string, Store<unknown>>()
const owners = new Map<string, SharedStore<unknown>>()

function slot(name: string): Store<unknown> {
  let store = slots.get(name)
  if (!store) {
    store = new Store<unknown>(undefined)
    slots.set(name, store)
  }
  return store
}

export function sharedFrom<T>(
  pluginId: string,
  key: string
): SharedStoreHandle<T> {
  const { get, subscribe, use } = slot(`${pluginId}:${key}`)
  return { get, subscribe, use } as SharedStoreHandle<T>
}

export class SharedStore<T> {
  private readonly slot: Store<unknown>

  constructor(
    private readonly name: string,
    initial: T
  ) {
    if (owners.has(name))
      throw new Error(`Shared store "${name}" already has an owner`)
    this.slot = slot(name)
    owners.set(name, this as SharedStore<unknown>)
    this.slot.set(initial)
  }

  get = (): T => this.slot.get() as T

  set = (next: T): void => {
    if (owners.get(this.name) !== this) return
    this.slot.set(next)
  }

  update = (updater: (value: T) => T): void => {
    this.set(updater(this.get()))
  }

  /** Reactively read the current value inside a component */
  use = (): T => this.slot.use() as T

  dispose = (): void => {
    if (owners.get(this.name) !== this) return
    owners.delete(this.name)
    this.slot.set(undefined)
  }
}

export function bindSharedStore(
  pluginId: string,
  track: (cleanup: () => void) => void
) {
  return class BoundSharedStore<T> extends SharedStore<T> {
    constructor(key: string, initial: T) {
      super(`${pluginId}:${key}`, initial)
      track(this.dispose)
    }
  }
}
