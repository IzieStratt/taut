// Makes Slackbot custom responses be from Slackbot again

import { TautPlugin } from '$taut'

export default class BringBackSlackbot extends TautPlugin<
  typeof BringBackSlackbot
> {
  static readonly id = 'BringBackSlackbot'
  static readonly pluginName = 'Bring Back Slackbot'
  static readonly description =
    'Makes Slackbot custom responses be from Slackbot again'
  static readonly authors = '<@U06UYA5GMB5>'
  static readonly defaultConfig = {
    enabled: true,
  }

  start(): void {
    this.api.redux.patchSlice<{ group?: string }>(
      'experiments',
      (id, experiment) =>
        id === 'reskin_custom_responses' && experiment?.group === 'on'
          ? { ...experiment, group: 'off' }
          : experiment
    )
    this.log('Started')
  }
}
