// Taut Config Store
// In-memory store for config.jsonc and user.css with change notifications

import type { DefaultConfig } from '../shared/Plugin'
import type { TautBridge } from '../shared/TautBridge'
import { defaultUserCss, emptyConfig } from './bundledData'
import { initJsonc, type JsoncParser } from './cdn'
import {
  addPluginDefaults,
  appendEntries,
  checkPluginEdit,
  detectLayout,
  renderEntries,
} from './configEdit'
import {
  defaultEntries,
  descriptionLines,
  unwrapDefaults,
} from './pluginConfig'

export interface TautConfig {
  plugins: Record<string, { enabled: boolean } & Record<string, unknown>>
  telemetry?: boolean
}

type Listener<T> = (value: T) => void
type Unsubscribe = () => void

export class ConfigStore {
  private configText = ''
  private userCssText = ''
  private config: TautConfig = { plugins: {} }
  private configListeners = new Set<Listener<TautConfig>>()
  private configTextListeners = new Set<Listener<string>>()
  private cssListeners = new Set<Listener<string>>()
  private jsonc!: JsoncParser
  private ensureConfigQueue: Promise<void> = Promise.resolve()

  constructor(private bridge: TautBridge) {}

  async init(): Promise<void> {
    this.jsonc = await initJsonc()
    this.configText = (await this.bridge.readConfigText()) || emptyConfig
    this.userCssText = (await this.bridge.readUserCss()) || defaultUserCss
    this.config = this.parseConfig(this.configText)

    this.bridge.onConfigTextChange((text) => {
      this.configText = text
      this.config = this.parseConfig(text)
      this.notifyConfigTextListeners()
      this.notifyConfigListeners()
    })

    this.bridge.onUserCssChange((css) => {
      this.userCssText = css
      this.notifyCssListeners()
    })
  }

  private parseConfig(text: string): TautConfig {
    try {
      const parsed = this.jsonc.parse(text, undefined, {
        allowTrailingComma: true,
      }) as TautConfig | null
      return parsed && typeof parsed === 'object' ? parsed : { plugins: {} }
    } catch {
      return { plugins: {} }
    }
  }

  getConfig(): TautConfig {
    return this.config
  }

  getConfigText(): string {
    return this.configText
  }

  getUserCssText(): string {
    return this.userCssText
  }

  onConfigChange(listener: Listener<TautConfig>): Unsubscribe {
    this.configListeners.add(listener)
    return () => this.configListeners.delete(listener)
  }

  onConfigTextChange(listener: Listener<string>): Unsubscribe {
    this.configTextListeners.add(listener)
    return () => this.configTextListeners.delete(listener)
  }

  onUserCssChange(listener: Listener<string>): Unsubscribe {
    this.cssListeners.add(listener)
    return () => this.cssListeners.delete(listener)
  }

  async updateConfigText(newText: string): Promise<boolean> {
    const success = await this.bridge.writeConfigText(newText)
    if (success) {
      this.configText = newText
      this.config = this.parseConfig(newText)
      this.notifyConfigTextListeners()
      this.notifyConfigListeners()
    }
    console.log(
      '[Taut] Config update',
      success ? 'succeeded' : 'failed',
      newText
    )
    return success
  }

  async updateUserCssText(newCss: string): Promise<void> {
    const success = await this.bridge.writeUserCss(newCss)
    if (success) {
      this.userCssText = newCss
      this.notifyCssListeners()
    }
    console.log(
      '[Taut] User CSS update',
      success ? 'succeeded' : 'failed',
      newCss
    )
  }

  async setPluginEnabled(
    pluginName: string,
    enabled: boolean
  ): Promise<boolean> {
    const text = this.configText
    const tree = this.jsonc.parseTree(text, [], { allowTrailingComma: true })
    const block = tree
      ? this.jsonc.findNodeAtLocation(tree, ['plugins', pluginName])
      : undefined
    const hasEnabled =
      block?.type === 'object' &&
      (block.children ?? []).some((p) => p.children?.[0]?.value === 'enabled')
    let newText: string
    if (block?.type === 'object' && !hasEnabled) {
      // jsonc.modify would land the new property before a same-line comment
      const layout = detectLayout(text)
      newText = appendEntries(
        text,
        block,
        renderEntries([{ key: 'enabled', value: enabled }], layout.unit),
        layout
      )
    } else {
      const edits = this.jsonc.modify(
        text,
        ['plugins', pluginName, 'enabled'],
        enabled,
        { formattingOptions: { tabSize: 2, insertSpaces: true } }
      )
      newText = this.jsonc.applyEdits(text, edits)
    }
    const errors: import('jsonc-parser').ParseError[] = []
    this.jsonc.parseTree(newText, errors, { allowTrailingComma: true })
    if (
      errors.length > 0 ||
      this.parseConfig(newText).plugins[pluginName]?.enabled !== enabled
    ) {
      console.error(
        `[Taut] Refusing to save config: toggling ${pluginName} produced an invalid file`
      )
      return false
    }
    return this.updateConfigText(newText)
  }

  /**
   * Add a plugin's block to config.jsonc, or the default options its block is
   * missing. Never rewrites a file it can't parse, and checks that the edit
   * changed nothing else before saving. Calls are serialized so concurrent
   * plugin loads can't race each other.
   */
  async ensurePluginConfig(
    pluginName: string,
    defaults: DefaultConfig,
    description: string
  ): Promise<void> {
    const task = async () => {
      const before = this.configText.trim() ? this.configText : emptyConfig
      const outcome = addPluginDefaults(
        this.jsonc,
        before,
        pluginName,
        defaultEntries(defaults),
        descriptionLines(description)
      )
      if ('unchanged' in outcome) return
      if ('reason' in outcome) {
        console.warn(
          `[Taut] Not writing defaults for ${pluginName}: ${outcome.reason}`
        )
        return
      }
      const problem = checkPluginEdit(
        this.jsonc,
        before,
        outcome.text,
        pluginName,
        unwrapDefaults(defaults)
      )
      if (problem) {
        throw new Error(
          `Refusing to save config for plugin ${pluginName}: ${problem}`
        )
      }
      if (!(await this.updateConfigText(outcome.text))) {
        throw new Error(`Failed to save config for plugin ${pluginName}`)
      }
    }
    this.ensureConfigQueue = this.ensureConfigQueue.catch(() => {}).then(task)
    return this.ensureConfigQueue
  }

  private notifyConfigListeners() {
    for (const listener of this.configListeners) {
      listener(this.config)
    }
    console.log('[Taut] Notified config listeners', this.config)
  }

  private notifyConfigTextListeners() {
    for (const listener of this.configTextListeners) {
      listener(this.configText)
    }
  }

  private notifyCssListeners() {
    for (const listener of this.cssListeners) {
      listener(this.userCssText)
    }
  }
}
