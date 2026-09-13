// Adds buttons to open a member in Hack Club tools

import { type MenuTemplateItem, TautPlugin } from '$taut'

type MenuFromTemplateProps = { template?: MenuTemplateItem[] }
type OverflowMenuProps = { memberId?: string }

const TOOLS = [
  {
    id: 'identity',
    label: 'Open in Identity',
    url: (id: string) =>
      `https://auth.hackclub.com/backend/identities?search=${encodeURIComponent(id)}`,
  },
  {
    id: 'telescreen',
    label: 'Open in Telescreen',
    url: (id: string) =>
      `https://telescreen.hackclub.com/subjects/${encodeURIComponent(id)}`,
  },
  {
    id: 'joe',
    label: 'Open in Joe',
    url: (id: string) =>
      `https://joe.fraud.hackclub.com/profile/${encodeURIComponent(id)}`,
  },
  {
    id: 'admin',
    label: 'Open in Slack Admin',
    url: (id: string) =>
      `https://app.slack.com/manage/E09V59WQY1E/people/${encodeURIComponent(id)}`,
  }
]

export default class AdminBackend extends TautPlugin {
  static readonly id = 'AdminBackend'
  static readonly pluginName = 'Admin Backend'
  static readonly description =
    'Adds buttons to open a member in Hack Club tools'
  static readonly authors = '<@U06UYA5GMB5>, <@U080A3QP42C>'
  static readonly defaultConfig = `
    // Adds buttons to open a member in Hack Club tools
    "AdminBackend": {
      "enabled": false
    }
  `

  private readonly MemberIdContext = React.createContext<string | null>(null)

  start(): void {
    this.api.patchComponent<OverflowMenuProps>(
      'RimetoMemberProfileOverflowMenu',
      (Original) => (props) => (
        <this.MemberIdContext.Provider value={props.memberId ?? null}>
          <Original {...props} />
        </this.MemberIdContext.Provider>
      )
    )

    this.api.patchComponent<MenuFromTemplateProps>(
      'MenuFromTemplate',
      (Original) => (props) => {
        const memberId = React.useContext(this.MemberIdContext)
        const template = props.template
        if (!memberId || !Array.isArray(template))
          return <Original {...props} />
        if (
          template.some((item) => item?.key?.startsWith('taut-admin-backend__'))
        )
          return <Original {...props} />

        const next = [
          ...template,
          { key: 'taut-admin-backend__separator', type: 'separator' as const },
          ...TOOLS.map((tool) => ({
            key: `taut-admin-backend__${tool.id}`,
            label: tool.label,
            click: () =>
              window.open(tool.url(memberId), '_blank', 'noopener,noreferrer'),
          })),
        ]
        return <Original {...props} template={next} />
      }
    )

    this.log('Started')
  }
}
