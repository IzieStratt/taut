// Taut React Utilities
// Provides utilities for finding and patching React components

import { Store } from '../store'
import {
  findModuleId,
  forEachExport,
  getExport,
  getValueSource,
  waitForExport,
} from './webpack'

const global = globalThis as any

declare global {
  namespace React {
    interface Attributes {
      __original?: true
    }
  }
}

// React Detection

function isReact(exp: any): exp is typeof import('react') {
  return (
    exp &&
    typeof exp === 'object' &&
    'createElement' in exp &&
    'Component' in exp &&
    'useState' in exp
  )
}

function isJsxRuntime(exp: any): boolean {
  return !!(
    exp &&
    typeof exp === 'object' &&
    exp.jsx &&
    exp.jsxs &&
    exp.Fragment
  )
}

// Component Finding
// If using this outside of a plugin, ensure your desired component has loaded first

type filter = (exp: any) => boolean

function componentFilter(name: string, filter?: filter) {
  const func = (exp: any) => {
    if (!exp) return false
    if (filter && !filter(exp)) return false

    if (typeof exp === 'object') {
      if (exp.$$typeof === Symbol.for('react.memo')) {
        if (exp.displayName === name) return true
        if (getComponentName(exp.type) === name) return true
      }
      if (exp.$$typeof === Symbol.for('react.forward_ref')) {
        if (exp.displayName === name) return true
        if (exp.render?.displayName === name) return true
        if (exp.render?.name === name) return true
      }
    }

    if (typeof exp === 'function') {
      if (exp.displayName === name) return true
      if (exp.name === name) return true
    }

    return false
  }

  return func
}

// Only used for console warnings if an element doesn't load
const MISSING_MS = 30_000

/** Renders nothing until the component turns up, then renders it from then on */
export function lazyComponent<P extends {}>(
  name: string,
  filter?: filter
): React.ComponentType<P> {
  const match = componentFilter(name, filter)
  const component = new Store<React.ComponentType<P> | undefined>(undefined)
  let looked = false

  const look = () => {
    if (looked) return
    looked = true
    const loaded = getExport<React.ComponentType<P>>(match)
    if (loaded) {
      component.set(loaded)
      return
    }
    void waitForExport<React.ComponentType<P>>(match).then(component.set)
    setTimeout(() => {
      if (!component.get()) console.error(`[Taut] "${name}" is unavailable`)
    }, MISSING_MS)
  }

  function LazyComponent(props: P) {
    // resolving on the first render keeps an already-loaded component from flashing
    look()
    const Component = component.use()
    return Component ? <Component {...props} /> : null
  }
  LazyComponent.displayName = `Lazy(${name})`
  return LazyComponent
}

/** Resolves whenever the component turns up, for use outside a render */
export function waitForComponent<P extends {}>(
  name: string,
  filter?: filter
): Promise<React.ComponentType<P>> {
  return waitForExport<React.ComponentType<P>>(componentFilter(name, filter))
}

/** Throws if the component's chunk hasn't loaded yet */
export function getComponent<P extends {}>(
  name: string,
  all?: false,
  filter?: filter
): React.ComponentType<P>
export function getComponent<P extends {}>(
  name: string,
  all: true,
  filter?: filter
): React.ComponentType<P>[]
export function getComponent(name: string, all = false, filter?: filter) {
  const func = componentFilter(name, filter)

  if (all) return getExport(func, true)
  const result = getExport(func)
  if (!result) throw new Error(`[Taut] Could not find component: ${name}`)
  return result
}
global.waitForComponent = waitForComponent
global.getComponent = getComponent

// slack never exports plenty of components, and connect keeps no
// WrappedComponent link back, so note what resolveType sees instead
const renderedComponents = new Map<string, ComponentType>()
const renderedWaiters = new Map<string, Set<(c: ComponentType) => void>>()

function rememberRendered(type: any) {
  const name = getComponentName(type)
  if (!name || renderedComponents.has(name)) return
  renderedComponents.set(name, type)

  const waiters = renderedWaiters.get(name)
  if (!waiters) return
  renderedWaiters.delete(name)
  for (const resolve of waiters) resolve(type)
}

/** Knows only what has been on screen, unlike getComponent which reads exports (avoid if you can) */
export function getRenderedComponent(name: string): ComponentType | undefined {
  return renderedComponents.get(name)
}

/**
 * Use for components Slack never exports, which only become reachable after
 * something mounts them; resolves immediately if one already has. Avoid if you can
 */
export function waitForRenderedComponent(name: string): Promise<ComponentType> {
  const seen = renderedComponents.get(name)
  if (seen) return Promise.resolve(seen)

  return new Promise((resolve) => {
    let waiters = renderedWaiters.get(name)
    if (!waiters) {
      waiters = new Set()
      renderedWaiters.set(name, waiters)
    }
    waiters.add(resolve)
  })
}

global.lazyComponent = lazyComponent
global.getRenderedComponent = getRenderedComponent
global.waitForRenderedComponent = waitForRenderedComponent
global.renderedComponents = renderedComponents

// Fiber Utilities (promise-wrapped)

function getRootFiber(): object | null {
  const container = document.querySelector('.p-client_container')
  if (!container) return null
  const key = Object.keys(container).find((k) =>
    k.startsWith('__reactContainer$')
  )
  if (!key) return null
  return (container as any)[key]
}

export function getFiberFromNode(node: Element): any | null {
  const key = Object.keys(node).find(
    (k) =>
      k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  )
  if (!key) return null
  return (node as any)[key]
}
global.getFiberFromNode = getFiberFromNode

function dirtyMemoizationCache() {
  const rootFiber = getRootFiber()
  if (!rootFiber) return

  const poison = (node: any) => {
    if (!node) return
    if (node.memoizedProps && typeof node.memoizedProps === 'object') {
      node.memoizedProps = { ...node.memoizedProps, _poison: 1 }
    }
    poison(node.child)
    poison(node.sibling)
  }
  poison(rootFiber)
}

// Component Patching

export type ComponentType<P = any> = React.ComponentType<P> | string

function getComponentName(component: any): string | null {
  if (!component) return null

  if (typeof component === 'object') {
    if (component.$$typeof === Symbol.for('react.memo')) {
      return getComponentName(component.type)
    }
    if (component.$$typeof === Symbol.for('react.forward_ref')) {
      return (
        component.displayName ||
        component.render?.displayName ||
        component.render?.name ||
        null
      )
    }
    if (component.$$typeof === Symbol.for('taut.originalComponent')) {
      return component.displayName || null
    }
  }

  if (typeof component === 'function') {
    return component.displayName || component.name || null
  }

  return null
}

function unwrapComponentLayers(component: any): any[] {
  const layers: any[] = []
  let current = component
  while (current && layers.length < 10) {
    layers.push(current)
    if (isOriginalComponentObject(current)) {
      current = current.originalComponent
    } else if (typeof current === 'object') {
      if (current.$$typeof === Symbol.for('react.memo')) {
        current = current.type
      } else if (current.$$typeof === Symbol.for('react.forward_ref')) {
        current = current.render
      } else {
        break
      }
    } else {
      break
    }
  }
  return layers
}

/** Get the source code of a React component, best-effort to get the whole module */
export function getComponentSource(component: ComponentType): string {
  if (typeof component === 'string') {
    throw new Error(`[Taut] "${component}" is a host element, not a component`)
  }
  const layers = unwrapComponentLayers(component)
  for (const layer of layers) {
    if (findModuleId(layer) !== undefined) return getValueSource(layer)
  }
  const innermost = layers[layers.length - 1]
  if (typeof innermost === 'function') return innermost.toString()
  throw new Error(`[Taut] Could not find source for component`, {
    cause: component,
  })
}
global.getComponentSource = getComponentSource

function getDisplayName(component: ComponentType): string {
  if (typeof component === 'string') return component
  const name = getComponentName(component)
  if (name) return name
  return 'Component'
}

type componentMatcher = (component: ComponentType) => boolean
export type componentReplacer<P = any> = (
  OriginalComponent: ComponentType<P>
) => ComponentType<P>

const componentReplacements = new Map<componentMatcher, componentReplacer>()

// components that match no replacers
let notPatchedCache = new WeakSet<object>()
// component -> its replaced component
let resolvedComponentCache = new WeakMap<object, ComponentType>()

function invalidateComponentCaches() {
  notPatchedCache = new WeakSet<object>()
  resolvedComponentCache = new WeakMap<object, ComponentType>()
}

const originalComponentSymbol = Symbol.for('taut.originalComponent')

const originalComponentObjectCache = new WeakMap<any, originalComponentObject>()
type originalComponentObject = {
  $$typeof: typeof originalComponentSymbol
  originalComponent: ComponentType
  displayName: string
}

function getOriginalComponentObject(
  component: ComponentType
): originalComponentObject {
  if (originalComponentObjectCache.has(component)) {
    return originalComponentObjectCache.get(
      component
    ) as originalComponentObject
  }
  const obj: originalComponentObject = {
    $$typeof: originalComponentSymbol,
    originalComponent: component,
    displayName: getDisplayName(component),
  }
  originalComponentObjectCache.set(component, obj)
  return obj
}

function isOriginalComponentObject(
  component: any
): component is originalComponentObject {
  return (
    typeof component === 'object' &&
    component !== null &&
    component.$$typeof === originalComponentSymbol &&
    'originalComponent' in component
  )
}

const notHoisted = new Set([
  'length',
  'name',
  'prototype',
  'caller',
  'callee',
  'arguments',
  'displayName',
  'defaultProps',
  'propTypes',
  'contextType',
  'contextTypes',
  'childContextTypes',
  'getDerivedStateFromProps',
  'getDerivedStateFromError',
  '$$typeof',
  'type',
  'render',
  'compare',
])

/**
 * copy static values from the original component to the replaced component
 */
function hoistStatics(replaced: any, original: any): void {
  const holds = (value: any) =>
    value && (typeof value === 'function' || typeof value === 'object')
  if (!holds(replaced) || !holds(original)) return
  for (const key of Object.getOwnPropertyNames(original)) {
    if (notHoisted.has(key) || Object.hasOwn(replaced, key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(original, key)
    if (!descriptor) continue
    try {
      Object.defineProperty(replaced, key, descriptor)
    } catch {}
  }
}

const replacerResultCache = new WeakMap<
  componentReplacer,
  Map<ComponentType, ComponentType>
>()

function applyReplacerWithCache<P = any>(
  replacer: componentReplacer<P>,
  originalComponent: ComponentType<P>
): ComponentType<P> {
  let resultCache = replacerResultCache.get(replacer)
  if (!resultCache) {
    resultCache = new Map<ComponentType, ComponentType>()
    replacerResultCache.set(replacer, resultCache)
  }
  if (resultCache.has(originalComponent)) {
    return resultCache.get(originalComponent) as ComponentType<P>
  }

  const replaced = replacer(originalComponent)
  if (typeof replaced === 'function' && !('displayName' in replaced)) {
    replaced.displayName = `Patched(${getDisplayName(originalComponent)})`
  }

  resultCache.set(originalComponent, replaced)
  return replaced
}

// Shared component resolution
// Given the type/component argument passed to createElement or jsx/jsxs,
// return the type that should actually be rendered: either the original
// component (when no replacers match, or when explicitly opting out via
// __original), or the replacer-transformed component. Results are memoized
// per component identity so matchers run at most once per type.
function resolveType(type: any, props: any): any {
  // __original opts a single render out of patching
  // the original component object is preferable, because
  // then multiple patches can be applied to the same component
  const __original = props?.__original
  if (__original) {
    delete props.__original
    return type
  }

  // Already an unwrapped original-component marker: render the wrapped target
  if (isOriginalComponentObject(type)) return type.originalComponent

  const cacheable = typeof type === 'object' || typeof type === 'function'
  if (cacheable && notPatchedCache.has(type)) return type
  if (cacheable && resolvedComponentCache.has(type)) {
    return resolvedComponentCache.get(type)
  }
  // past the caches, so this is the first time we've seen this component
  if (cacheable) rememberRendered(type)

  const replacers = [...componentReplacements.entries()]
    .filter(([matcher]) => matcher(type))
    .map(([, replacer]) => replacer)

  if (replacers.length > 0) {
    const originalComponent = getOriginalComponentObject(
      type
    ) as unknown as ComponentType
    const replaced = replacers.reduce(
      (current, replacer) => applyReplacerWithCache(replacer, current),
      originalComponent
    )
    hoistStatics(replaced, type)
    if (cacheable) resolvedComponentCache.set(type, replaced)
    return replaced
  }

  if (cacheable) notPatchedCache.add(type)
  return type
}

function patchComponent<P = object>(
  matcher:
    | string
    | { displayName?: string; filter?: filter; component?: ComponentType<P> },
  replacement: componentReplacer<P>
): () => void {
  const displayName =
    typeof matcher === 'string' ? matcher : matcher.displayName
  const filter = typeof matcher === 'string' ? undefined : matcher.filter
  const component = typeof matcher === 'string' ? undefined : matcher.component

  const matcherFunc: componentMatcher = (comp: any) => {
    if (component && comp === component) return true
    if (displayName === undefined && !filter) return false
    if (displayName !== undefined && getComponentName(comp) !== displayName) {
      return false
    }
    if (filter && !filter(comp)) return false
    return true
  }

  componentReplacements.set(matcherFunc, replacement)

  invalidateComponentCaches()
  dirtyMemoizationCache()
  console.log(`[Taut] patchComponent: Patched component`, componentReplacements)
  return () => {
    componentReplacements.delete(matcherFunc)
    invalidateComponentCaches()
    dirtyMemoizationCache()
    console.log(`[Taut] patchComponent: Unpatched component`)
  }
}

// Runtime Patching
// Both React module variants are intercepted the same way via forEachExport:
// find every matching module (existing + future), wrap the render function so
// all element types pass through resolveType before React sees them
export const reactPromise: Promise<typeof import('react')> = new Promise(
  (resolve) => {
    forEachExport(isReact, (React) => {
      const originalCreateElement = React.createElement
      React.createElement = (type: any, props: any, ...children: any[]) =>
        originalCreateElement(resolveType(type, props), props, ...children)
      global.React = React
      resolve(React)
    })
  }
)

export const jsxRuntimePromise: Promise<void> = new Promise((resolve) => {
  forEachExport(isJsxRuntime, (rt) => {
    const originalJsx = rt.jsx as (type: any, props: any, key: any) => any
    const originalJsxs = rt.jsxs as (type: any, props: any, key: any) => any
    rt.jsx = (type: any, props: any, key: any) =>
      originalJsx(resolveType(type, props), props, key)
    rt.jsxs = (type: any, props: any, key: any) =>
      originalJsxs(resolveType(type, props), props, key)
    resolve()
  })
})

// patchComponentPromise: expose patchComponent once both runtimes are patched.
export const patchComponentPromise = (async () => {
  await reactPromise
  await jsxRuntimePromise
  global.patchComponent = patchComponent
  return patchComponent
})()
