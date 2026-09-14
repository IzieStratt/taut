// Suppresses typing indicators so others can't see when you're typing

import { TautPlugin } from '$taut'

export default class SilentTyping extends TautPlugin<typeof SilentTyping> {
  static readonly id = 'SilentTyping'
  static readonly pluginName = 'Silent Typing'
  static readonly description =
    "Adds a button to suppress typing indicators so others can't see when you're typing"
  static readonly authors = '<@U06UYA5GMB5>, <@U080A3QP42C>, <@U01D9DWGEB0>'
  static readonly defaultConfig = {
    enabled: false,
  }

  private static readonly STORAGE_KEY = 'taut_silent_typing_suppressed'
  private suppressed = false
  private readonly listeners = new Set<(v: boolean) => void>()

  private setSuppressed(v: boolean) {
    this.suppressed = v
    localStorage.setItem(SilentTyping.STORAGE_KEY, String(v))
    for (const l of this.listeners) l(v)
  }

  start(): void {
    this.suppressed = localStorage.getItem(SilentTyping.STORAGE_KEY) === 'true'

    for (const name of ['MessagePaneInput', 'InputContainer'] as const) {
      this.api.patchComponent<{
        currentUserStartedTyping?: () => void
        currentUserEndedTyping?: () => void
      }>(name, (Original) => (props) => {
        const [isSuppressed, setIsSuppressed] = React.useState(this.suppressed)

        React.useEffect(() => {
          this.listeners.add(setIsSuppressed)
          return () => {
            this.listeners.delete(setIsSuppressed)
          }
        }, [])

        if (isSuppressed) {
          props = {
            ...props,
            currentUserStartedTyping: () => {},
            currentUserEndedTyping: () => {},
          }
        }

        return <Original {...props} />
      })
    }

    const Tooltip = this.api.elements.Tooltip
    const IconButtonBase = this.api.elements.IconButtonBase
    const SvgIcon = this.api.elements.SvgIcon

    this.api.patchComponent<{ children?: React.ReactNode }>(
      'TextyButtonOverflow',
      (Original) => (props) => {
        const [isSuppressed, setIsSuppressed] = React.useState(this.suppressed)

        React.useEffect(() => {
          this.listeners.add(setIsSuppressed)
          return () => {
            this.listeners.delete(setIsSuppressed)
          }
        }, [])

        const label = isSuppressed
          ? 'Allow typing notifications'
          : 'Suppress typing notifications'

        const children = React.Children.toArray(props.children)
        children.push(
          <Tooltip
            key="taut-silent-typing"
            tip={label}
            position="top"
            offsetY={-7}
            delay={500}
            zIndex="above_fs"
          >
            <IconButtonBase
              className="c-wysiwyg_container__button"
              aria-pressed={String(isSuppressed)}
              aria-label={label}
              onClick={() => this.setSuppressed(!isSuppressed)}
              tabIndex={-1}
              size="smedium"
            >
              <SvgIcon
                name={isSuppressed ? 'notifications-off' : 'notifications'}
                size={18}
              />
            </IconButtonBase>
          </Tooltip>
        )

        return <Original {...props}>{children}</Original>
      }
    )

    this.log('Started')
  }
}
