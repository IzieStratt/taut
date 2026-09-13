interface Env {
  ASSETS: Fetcher
  DB: D1Database
}

const GH = 'https://github.com/jeremy46231/taut/releases/download'

// every release asset is named taut[.-something...].ext, see scripts/lib/artifacts.ts
const RELEASE_ASSET =
  /^\/taut(?:[.-][a-z0-9]+)*\.(?:js|json|zip|xpi|dmg|exe|AppImage|deb|rpm|pacman)$/

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

const PING_CORS = {
  'access-control-allow-origin': 'https://app.slack.com',
  'access-control-allow-methods': 'POST',
  'access-control-allow-headers': 'content-type',
}

// see app/api/telemetry.ts
const PING_FIELDS = {
  install: /^[0-9a-f-]{36}$/,
  user: /^[UW][A-Z0-9]{8,12}$/,
  team: /^[TE][A-Z0-9]{8,12}$/,
  version: /^[\w.+-]{1,32}$/,
  loader: /^(electron|chrome-extension|firefox-extension|userscript)$/,
  loaderVersion: /^[\w.+-]{1,32}$/,
}

async function ping(request: Request, env: Env): Promise<Response> {
  const respond = (status: number, text = '') =>
    new Response(text || null, { status, headers: PING_CORS })
  if (request.method === 'OPTIONS') return respond(204)
  if (request.method !== 'POST') return respond(405)
  if (Number(request.headers.get('content-length')) > 2048) return respond(413)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return respond(400, 'not json')
  }
  const fields: Record<string, string> = {}
  for (const [key, pattern] of Object.entries(PING_FIELDS)) {
    const value = body[key]
    if (typeof value !== 'string' || !pattern.test(value)) {
      return respond(400, `bad ${key}`)
    }
    fields[key] = value
  }
  const embedded =
    typeof body.embedded === 'boolean' ? Number(body.embedded) : null
  const os = typeof body.os === 'string' ? body.os.slice(0, 32) : null

  await env.DB.prepare(
    `insert or ignore into pings
       (day, install, user, team, version, loader, loader_version, embedded, os)
     values (date(), ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      fields.install,
      fields.user,
      fields.team,
      fields.version,
      fields.loader,
      fields.loaderVersion,
      embedded,
      os
    )
    .run()
  return respond(204)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return Response.redirect('https://github.com/jeremy46231/taut', 302)
    }

    if (url.pathname === '/ping') return ping(request, env)

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
