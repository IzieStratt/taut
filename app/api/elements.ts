// Taut Elements Registry
// Central place to find Slack's React components

import { lazyComponent, reactPromise } from '../slack/react'

export type SvgIconProps = {
  name: string
  size?: number
  inline?: boolean
}

export type MrkdwnElementProps = {
  text: string
}

export type ButtonProps = {
  type?: 'primary' | 'ghost' | 'outline' | 'danger'
  size?: 'small' | 'medium' | 'large'
  icon?: string
  href?: string
  htmlType?: 'button' | 'submit' | 'reset'
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'size'>

export type TooltipProps = {
  tip: React.ReactNode
  position?: string
  offsetY?: number
  delay?: number
  zIndex?: string
  children?: React.ReactNode
}

export type IconButtonBaseProps = {
  size?: string
  className?: string
  'aria-pressed'?: string
  'aria-label'?: string
  'data-qa'?: string
  onClick?: () => void
  tabIndex?: number
  children?: React.ReactNode
}

export type ConfirmationModalProps = {
  title?: React.ReactNode
  children?: React.ReactNode
  onSubmit?: () => void
  onCancel?: () => void
  onClose?: () => void
  submitButtonText?: string
  cancelButtonText?: string
  submitButtonType?: 'primary' | 'danger'
  showCancelButton?: boolean
  showSubmitButton?: boolean
  disableSubmitButton?: boolean
}

/** the error line under a form field, warning icon included */
export type InlineAlertProps = {
  children?: React.ReactNode
  className?: string
  id?: string
}

export type LabelProps = {
  text: React.ReactNode
  htmlFor?: string
  subtext?: React.ReactNode
  optional?: boolean
  type?: 'block' | 'inline'
  isDisabled?: boolean
  className?: string
  id?: string
}

/** One row of a Slack menu */
export type MenuTemplateItem = {
  key: string
  label?: React.ReactNode
  description?: React.ReactNode
  type?: 'submenu' | 'separator' | 'header' | 'custom'
  /** the rows of a `submenu` item */
  template?: MenuTemplateItem[]
  /** an `SvgIcon` name */
  icon?: string
  click?: (e?: unknown) => void
  disabled?: boolean
  danger?: boolean
}

/**
 * Slack's two-field date range control, with a calendar popover.
 * Dates are strings in `dateFormat`, which defaults to YYYY-MM-DD.
 */
export type DateRangePickerProps = {
  id?: string
  className?: string
  /** initial value only: the picker is uncontrolled after mount */
  selectedStartDate?: string | null
  selectedEndDate?: string | null
  /** the picker manages its own state; these only report the new value */
  onStartDateChange?: (change: { selectedStartDate: string }) => void
  onEndDateChange?: (change: { selectedEndDate: string }) => void
  /** how dates are parsed and reported back, e.g. "YYYY-MM-DD" */
  dateFormat?: string
  /** how dates are shown, when it should differ from `dateFormat` */
  displayFormat?: string | null
  disabledDates?: string[]
  disableDatesBefore?: string
  disableDatesAfter?: string
  /** cap the span the user can pick, in days */
  maxRange?: number
  size?: 'small' | 'medium' | 'large'
  width?: number | null
  placeholderText?: string | null
  startInputPlaceholder?: string
  endInputPlaceholder?: string
  startInputAriaLabel?: string
  endInputAriaLabel?: string
  showClearSelection?: boolean
  endDateRequired?: boolean
  singleMonthMode?: boolean
  showPreviousMonth?: boolean
  closeAfterSelection?: boolean
  renderCalendarInPopover?: boolean
  onCalendarClose?: () => void
  dataQa?: string | null
  'aria-label'?: string
}

/** Slack's section wrapper: a FieldSet holding a Legend and its controls */
export type FieldSetProps = {
  id?: string
  'data-qa'?: string
  'data-qa-section'?: string
  children?: React.ReactNode
}

export type LegendProps = {
  className?: string
  children?: React.ReactNode
}

/** Secondary line under a control */
export type HintProps = {
  children?: React.ReactNode
  className?: string
}

/** One option in a BasicSelect */
export type SelectOption = { label: string; value: string }

export type BasicSelectProps = {
  selectId: string
  options: SelectOption[]
  selectedOption?: SelectOption
  onSelectionChange: (option: SelectOption) => void
  width?: number
  ariaLabel?: string
  selectDataQa?: string
  isDisabled?: boolean
}

export type BlocksProps = {
  msg: { blocks?: unknown[]; [key: string]: unknown }
  blocksContainerContext?: 'message' | string
  streaming?: boolean
}

/** Slack's avatar, for either a member (`userId`) or a bot (`botId`) */
export type AvatarProps = {
  userId?: string
  botId?: string
  /** the bot as the message recorded it, used until the store has its own copy */
  botProfile?: object
  /** an image set to draw instead of the member's or bot's own */
  icons?: object
  /** side length in pixels; also picks which stored image size is used */
  size?: number
  className?: string
  /** whether it links to the profile and reacts to a click */
  isInteractive?: boolean
  /** open the profile card on hover */
  showCard?: boolean
  showTooltip?: boolean
  messageTs?: string
  ariaHidden?: string
  tabIndex?: number
  'data-qa'?: string
}

/** Wraps a trigger so hovering it opens Slack's profile card */
export type ProfileHoverTriggerProps = {
  /** the member whose profile to show */
  memberId?: string
  /** the bot (`B...`) whose app profile to show */
  serviceId?: string
  /** the bot as the message recorded it, used until the store has its own copy */
  botProfile?: object
  messageTs?: string
  position?: string
  /** leave off the wrapper's own class */
  noStyling?: boolean
  children?: React.ReactNode
}

export type MenuFromTemplateProps = { template?: MenuTemplateItem[] }

export type MenuTriggerProps = {
  position?: 'top' | 'bottom' | 'left' | 'right'
  isDisabled?: boolean
  renderMenu: (menuProps: object) => React.ReactNode
  children?: React.ReactNode
}

export type FormTextInputProps = {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onFocus?: React.FocusEventHandler<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  placeholder?: string
  hintText?: string | null
  errorText?: string | null
  isDisabled?: boolean
  isInvalid?: boolean
  isRequired?: boolean
  size?: 'small' | 'medium' | 'large'
  autoFocus?: boolean
  autoComplete?: string
  maxCharacterLimit?: number | null
  className?: string
}

export const elementsAPIPromise = (async () => {
  await reactPromise

  return {
    SvgIcon: lazyComponent<SvgIconProps>('SvgIcon'),
    Avatar: lazyComponent<AvatarProps>('ConnectedBaseAvatar'),
    ProfileHoverTrigger: lazyComponent<ProfileHoverTriggerProps>(
      'ProfileHoverTrigger'
    ),
    MrkdwnElement: lazyComponent<MrkdwnElementProps>('MrkdwnElement'),
    Button: lazyComponent<ButtonProps>('Button'),
    Tooltip: lazyComponent<TooltipProps>('Tooltip'),
    IconButtonBase: lazyComponent<IconButtonBaseProps>('IconButtonBase'),
    ConfirmationModal:
      lazyComponent<ConfirmationModalProps>('ConfirmationModal'),
    InlineAlert: lazyComponent<InlineAlertProps>('InlineAlert'),
    Label: lazyComponent<LabelProps>('Label'),
    FormTextInput: lazyComponent<FormTextInputProps>('FormTextInput'),
    DateRangePicker: lazyComponent<DateRangePickerProps>('DateRangePicker'),
    FieldSet: lazyComponent<FieldSetProps>('FieldSet'),
    Legend: lazyComponent<LegendProps>('Legend'),
    Hint: lazyComponent<HintProps>('Hint'),
    BasicSelect: lazyComponent<BasicSelectProps>('BasicSelect'),
    Blocks: lazyComponent<BlocksProps>('Blocks'),
    MenuTrigger: lazyComponent<MenuTriggerProps>('MenuTrigger'),
    MenuFromTemplate: lazyComponent<MenuFromTemplateProps>('MenuFromTemplate'),
  }
})()

export type ElementsAPI = Awaited<typeof elementsAPIPromise>
