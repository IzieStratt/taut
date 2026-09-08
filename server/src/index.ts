interface Env {
  ASSETS: Fetcher
}

const GH = 'https://github.com/jeremy46231/taut/releases/download'

// every release asset is named taut[.-something...].ext, see scripts/lib/artifacts.ts
const RELEASE_ASSET =
  /^\/taut(?:[.-][a-z0-9]+)*\.(?:js|zip|xpi|dmg|exe|AppImage|deb|rpm|pacman)$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return Response.redirect('https://github.com/jeremy46231/taut', 302)
    }

    if (RELEASE_ASSET.test(url.pathname)) {
      return Response.redirect(`${GH}/latest${url.pathname}`, 302)
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
