interface Env {
  ASSETS: Fetcher
}

const GH = 'https://github.com/jeremy46231/taut/releases/download'

// every release asset is named taut[.-something...].ext, see scripts/lib/artifacts.ts
const RELEASE_ASSET =
  /^\/taut(?:[.-][a-z0-9]+)*\.(?:js|zip|xpi|dmg|exe|AppImage|deb|rpm|pacman)$/

const REPO_ROUTES: Array<
  [RegExp, release: string, asset: (m: RegExpMatchArray) => string]
> = [
  [
    /^\/apt\/dists\/stable\/(?:main\/binary-(\w+)\/)?([\w.]+)$/,
    'repo',
    (m) => `apt-${m[1] ? `${m[1]}-` : ''}${m[2]}`,
  ],
  [/^\/apt\/pool\/(taut-linux(?:-arm)?\.deb)$/, 'latest', (m) => m[1]],
  [/^\/rpm\/repodata\/([\w.-]+)$/, 'repo', (m) => `rpm-repodata-${m[1]}`],
  [/^\/rpm\/(taut-linux(?:-arm)?\.rpm)$/, 'latest', (m) => m[1]],
]

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return Response.redirect('https://github.com/jeremy46231/taut', 302)
    }

    if (RELEASE_ASSET.test(url.pathname)) {
      return Response.redirect(`${GH}/latest${url.pathname}`, 302)
    }

    for (const [pattern, release, asset] of REPO_ROUTES) {
      const match = url.pathname.match(pattern)
      if (match)
        return Response.redirect(`${GH}/${release}/${asset(match)}`, 302)
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
