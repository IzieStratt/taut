// Simplifies and cleans up the message box

import { TautPlugin } from '$taut'

type TextyButtonsProps = Record<string, unknown>
type PrefPayload = { pref?: string; value?: unknown }
type PrefsBoot = { prefsData?: Record<string, unknown> }
type InputContainerProps = { dontShowBroadcastControls?: boolean }

const SCOPE = '.p-message_input__input_container_unstyled'

/** slack's account-wide pref for the formatting bar */
const PREFS = 'userPrefs'
const FORMATTING_PREF = 'msg_input_sticky_composer'
const FORMATTING_KEY = 'showFormatting'
const SLACK_KEY = 'slackShowFormatting'

// store a copy sync to prevent unstyled flashes
const MIRROR_KEY = 'taut_slim_message_box_formatting'
const readMirror = (): boolean | undefined => {
  const raw = localStorage.getItem(MIRROR_KEY)
  return raw === null ? undefined : raw === 'true'
}
const writeMirror = (value: boolean) =>
  localStorage.setItem(MIRROR_KEY, String(value))

/** the message claims this much, and the buttons sit beside it only if they fit */
const MIN_EDITOR_WIDTH = 450

/**
 * a container query cannot ask what the buttons measure, so estimate: slack's
 * row is ~340px, less what you turned off. Only decides when one line starts, so
 * being wrong costs message width rather than breaking the layout
 */
const CONTAINER = 'taut-composer'
const SLACK_BUTTON_ROW = 340
const BUTTON_WIDTH = 32
const oneLineWidth = (hidden: number) =>
  `${MIN_EDITOR_WIDTH + SLACK_BUTTON_ROW - hidden * BUTTON_WIDTH}px`

/** the props each option turns off when you set it false */
const BUTTON_PROPS: Record<string, string[]> = {
  showFormattingToggle: ['enableComposerButton'],
  showEmojiPicker: ['enableEmojiButton'],
  showMentionButton: ['enableMentionButton'],
  showVideoButton: ['enableStoryButton'],
  showAudioButton: ['enableAudioButton'],
  showSlashButton: ['enableSlashCommandsButton', 'enableShortcutsButton'],
}

// attachments get slack's stacked layout back, since they need the full width
const ONE_LINE = `${SCOPE}:not(:has(.c-wysiwyg_container__attachments, .p-message_input__attachments, .c-pending_files, .c-message__editor__composer_attachments))`

const layoutCss = (hiddenButtons: number) => `
  ${SCOPE} { container: ${CONTAINER} / inline-size; }

  ${ONE_LINE} .c-basic_container__body {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap;
    align-items: flex-end !important;
    column-gap: 6px;
  }
  /* everything slack stacks above the editor (alerts, the formatting bar) keeps a
     full-width row, in the order its grid-template-areas gives them */
  ${ONE_LINE} .c-basic_container__body > * { order: 0; flex: 1 0 100%; }
  ${ONE_LINE} .c-basic_container__body > :empty { display: none; }
  ${ONE_LINE} .c-wysiwyg_container__formatting { order: 1; }
  ${ONE_LINE} .c-wysiwyg_container__message_suggestions { order: 2; }
  ${ONE_LINE} .c-texty_input_unstyled__container {
    order: 3;
    flex: 100 1 0% !important;
    min-width: min(${MIN_EDITOR_WIDTH}px, 100%);
  }
  ${ONE_LINE} .c-wysiwyg_container__draft { order: 4; }
  ${ONE_LINE} .p-threads_footer__input_container__broadcast_controls {
    order: 5;
    flex: 1 0 100%;
  }
  /* whole and last, so attach, buttons and send wrap as a unit with send in the
     corner. Its own line below the query, where the contained row measures ~0 */
  ${ONE_LINE} .c-wysiwyg_container__footer {
    display: flex !important;
    order: 6;
    flex: 1 0 100% !important;
    flex-wrap: wrap;
    min-width: 0;
  }
  ${ONE_LINE} .c-wysiwyg_container__suffix {
    margin-left: auto !important;
    flex: 0 0 auto !important;
  }

  @container ${CONTAINER} (min-width: ${oneLineWidth(hiddenButtons)}) {
    ${ONE_LINE} .c-wysiwyg_container__footer { flex: 1 1 auto !important; }
    /* with no floor to wrap against the toolbar always fits beside the message,
       so the checkbox stays under it. Capping it instead strands send on a row */
    ${ONE_LINE}:has(.p-threads_footer__input_container__broadcast_controls)
      .c-texty_input_unstyled__container {
      min-width: 0 !important;
    }
    /* slack leaves this no bottom padding, having always had the buttons below it */
    ${ONE_LINE} .p-threads_footer__input_container__broadcast_controls {
      order: 7;
      padding-bottom: 8px;
    }
    /* slack sizes this row from the OUTSIDE (container-type: inline-size), so
       beside the message it comes out 0 wide and the buttons spill over send.
       Dropping the box also reads as nothing to do to the overflow menu's test,
       which starts at an offsetWidth && */
    ${ONE_LINE} .c-wysiwyg_container__toolbar_buttons {
      flex: 0 1 auto !important;
      min-width: 0 !important;
    }
    ${ONE_LINE} .c-texty_buttons { display: contents !important; }
  }
`

const COMPACT_CSS = `
  ${SCOPE} .c-wysiwyg_container__footer_divider { display: none !important; }
`

const NO_BROADCAST_CSS = `
  .p-threads_footer__input_container { min-height: 0; }
`

export default class SlimMessageBox extends TautPlugin<typeof SlimMessageBox> {
  static readonly id = 'SlimMessageBox'
  static readonly pluginName = 'Slim Message Box'
  static readonly description = 'Simplifies and cleans up the message box'
  static readonly authors = '<@U06UYA5GMB5>, <@U080A3QP42C>'
  static readonly defaultConfig = {
    enabled: false,
    oneLineLayout: true,
    showFormattingToggle: true,
    showEmojiPicker: true,
    showMentionButton: false,
    showVideoButton: false,
    showAudioButton: true,
    showSlashButton: false,
    showBroadcastCheckbox: true,
  }

  /** what the formatting bar was set to before we swapped ours in */
  private slackFormatting: boolean | undefined
  private formatting: boolean | undefined
  /** whether the dispatch in flight is ours, echoing a value we only read */
  private echoing = false
  /** the read of that value, which anything learning it has to wait behind */
  private recorded: Promise<void> | undefined

  start(): void {
    // only an explicit false hides one, so a config missing a key keeps its button
    const hidden = Object.keys(BUTTON_PROPS).filter(
      (option) => this.config[option] === false
    )
    const off = Object.fromEntries(
      hidden.flatMap((option) =>
        BUTTON_PROPS[option].map((prop) => [prop, false])
      )
    )

    this.api.setStyle(COMPACT_CSS)

    // slack ships minButtonsForOverflow: 5 against a group of 2, so the menu it
    // has for narrow composers never opens and the buttons just overlap instead
    this.api.patchComponent<TextyButtonsProps>(
      'TextyButtons',
      (Original) => (props) => (
        <Original {...props} {...off} minButtonsForOverflow={1} />
      )
    )

    if (this.config.showBroadcastCheckbox === false) {
      this.api.patchComponent<InputContainerProps>(
        'InputContainer',
        (Original) => (props) => (
          <Original {...props} dontShowBroadcastControls />
        )
      )
      this.api.setStyle(NO_BROADCAST_CSS)
    }

    if (this.config.oneLineLayout !== false)
      this.api.setStyle(layoutCss(hidden.length))

    void this.separateFormattingBar()

    this.log('Started')
  }

  async stop(): Promise<void> {
    localStorage.removeItem(MIRROR_KEY)
    if (this.slackFormatting === undefined) return
    // still hits the patched thunks
    await this.apply(this.slackFormatting)
    await this.api.storage.delete(SLACK_KEY)
  }

  private async separateFormattingBar() {
    const redux = this.api.redux
    const pref = (): boolean | undefined =>
      redux.getStore()?.getState()?.[PREFS]?.[FORMATTING_PREF]
    const settle = async (value: boolean | undefined) => {
      if (value !== undefined && value !== !!pref()) await this.apply(value)
    }

    const truth = this.api.storage.get(FORMATTING_KEY, false)
    this.recorded = this.api.storage
      .get<boolean | null>(SLACK_KEY, null)
      .then((stored) => {
        if (stored !== null) this.slackFormatting = stored
      })
    this.formatting = readMirror()

    redux.patchThunk(
      'setUserPrefFetcher',
      (original) => (payload: PrefPayload) =>
        payload?.pref === FORMATTING_PREF
          ? () => Promise.resolve()
          : original(payload)
    )
    redux.patchThunk(
      'setUserPrefByApi',
      (original) => (payload: PrefPayload) => {
        if (payload?.pref === FORMATTING_PREF && !this.echoing) {
          this.formatting = !!payload.value
          writeMirror(this.formatting)
          void this.api.storage.set(FORMATTING_KEY, this.formatting)
        }
        return original(payload)
      }
    )
    redux.patchThunk(
      'initializeUserPrefs',
      (original) => (payload: PrefsBoot) => {
        const prefs = payload?.prefsData
        if (!prefs || !(FORMATTING_PREF in prefs)) return original(payload)
        void this.recordSlackFormatting(!!prefs[FORMATTING_PREF])
        return original({
          ...payload,
          prefsData: { ...prefs, [FORMATTING_PREF]: this.formatting ?? false },
        })
      }
    )

    void this.recordSlackFormatting(pref())
    await settle(this.formatting)

    this.formatting = await truth
    writeMirror(this.formatting)
    await this.recorded
    if (this.api.signal.aborted) return
    await settle(this.formatting)
  }

  private async apply(value: boolean) {
    this.echoing = true
    try {
      await this.showFormatting(value)
    } finally {
      this.echoing = false
    }
  }

  /** the account's own value, kept from whichever run first saw it */
  private async recordSlackFormatting(value: boolean | undefined) {
    // undefined !== false
    if (value === undefined) return
    await this.recorded
    if (this.slackFormatting !== undefined) return
    this.slackFormatting = value
    await this.api.storage.set(SLACK_KEY, value)
  }

  private showFormatting(value: boolean) {
    return this.api.redux.dispatchThunk('setUserPrefByApi', {
      pref: FORMATTING_PREF,
      value,
    })
  }
}
