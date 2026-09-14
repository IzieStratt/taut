// Optimizations that make Slack faster and smoother

import { TautPlugin } from '$taut'

const QUIET_MS = 150

const RESIZING = 'taut-resizing'
const LEFT_BASIS = '--taut-top-nav-left-basis'
const LEFT_CONTAINER = '.p-ia4_top_nav__left_container'

// the left container's basis is linear in the window width, so two samples of
// what slack's js picked lets us recreate it with css while pausing the js
const TOP_NAV_CSS = `
  .${RESIZING} ${LEFT_CONTAINER} {
    flex-basis: var(${LEFT_BASIS}) !important;
  }
`

export default class FasterSlack extends TautPlugin<typeof FasterSlack> {
  static readonly id = 'FasterSlack'
  static readonly pluginName = 'Faster Slack'
  static readonly description =
    'Optimizations that make Slack faster and smoother'
  static readonly authors = '<@U06UYA5GMB5>'
  static readonly defaultConfig = {
    enabled: true,
    optimizeResize: true,
  }

  /** [window width, the basis slack settled on], most recent last */
  private samples: [number, number][] = []

  start() {
    if (this.config.optimizeResize !== false) {
      this.api.setStyle(TOP_NAV_CSS, 'top-nav')
      this.sampleLeftBasis()
      this.api.deferResizeWork({
        quietMs: QUIET_MS,
        onHoldChange: (holding) => this.onHoldChange(holding),
      })
    }
    this.log('Started')
  }

  stop() {
    document.documentElement.classList.remove(RESIZING)
    document.documentElement.style.removeProperty(LEFT_BASIS)
    this.log('Stopped')
  }

  private onHoldChange(holding: boolean) {
    const { classList, style } = document.documentElement
    if (holding) {
      if (style.getPropertyValue(LEFT_BASIS)) classList.add(RESIZING)
      return
    }
    classList.remove(RESIZING)
    // slack writes its own basis as it re-renders, so read it after that
    requestAnimationFrame(() => this.sampleLeftBasis())
  }

  private sampleLeftBasis() {
    const container = document.querySelector<HTMLElement>(LEFT_CONTAINER)
    const basis = Number.parseFloat(container?.style.flexBasis ?? '')
    const width = window.innerWidth
    if (!Number.isFinite(basis) || !width) return

    const previous = this.samples.at(-1)
    if (previous && Math.abs(previous[0] - width) < 1) return
    const next: [number, number] = [width, basis]
    this.samples = [...this.samples, next].slice(-2)

    const [first, last] = this.samples
    let value = `calc(100vw * ${first[1] / first[0]})`
    if (last) {
      const slope = (last[1] - first[1]) / (last[0] - first[0])
      if (!(slope > 0)) return
      value = `calc(${last[1]}px + ${slope} * (100vw - ${last[0]}px))`
    }
    document.documentElement.style.setProperty(LEFT_BASIS, value)
  }
}
