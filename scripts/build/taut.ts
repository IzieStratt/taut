// Builds the main Taut app bundle (production + debug)

import fs from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import {
  APP,
  DIST,
  PLUGINS,
  ROOT,
  TAUT_DEBUG_JS,
  TAUT_JS,
} from '../lib/paths.ts'
import { bundlePlugin } from '../lib/plugin.ts'
import { versions } from '../lib/versions.ts'

const TAUT_SOURCE_ORIGIN = 'taut:///'

// sources come out relative to the repo root; esbuild also lists synthetic
// <define:...> entries, which stay as they are
function rewriteSourcePath(p: string): string {
  if (p.startsWith('<')) return p
  return TAUT_SOURCE_ORIGIN + p.replace(/^\.\//, '')
}

function rewriteInlineSourcemaps(code: string): string {
  const re = /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/g
  return code.replace(re, (_full, b64: string) => {
    const map = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    if (Array.isArray(map.sources)) {
      delete map.sourceRoot
      // the <define:...> pseudo-source would otherwise embed every plugin bundle again
      if (Array.isArray(map.sourcesContent)) {
        map.sourcesContent = map.sourcesContent.map((c: string, i: number) =>
          map.sources[i].startsWith('<') ? null : c
        )
      }
      map.sources = map.sources.map((s: string) => rewriteSourcePath(s))
    }
    const next = Buffer.from(JSON.stringify(map), 'utf8').toString('base64')
    return `sourceMappingURL=data:application/json;base64,${next}`
  })
}

// Step 1: bundle plugins into a Record<string, string>
async function bundlePlugins(debug: boolean): Promise<Record<string, string>> {
  const plugins: Record<string, string> = {}
  if (!fs.existsSync(PLUGINS)) return plugins

  for (const file of fs
    .readdirSync(PLUGINS)
    .filter((f) => /\.[tj]sx?$/.test(f) && !f.includes('.disabled.'))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    const name = path.basename(file, path.extname(file))
    console.log(`[build-taut] Bundling plugin: ${name}`)
    plugins[name] = await bundlePlugin(path.join(PLUGINS, file), debug)
  }

  return plugins
}

// Step 2: bundle app/main.ts with plugins inlined
async function bundleApp(
  plugins: Record<string, string>,
  debug: boolean,
  telemetry: boolean
): Promise<string> {
  console.log('[build-taut] Bundling app...')

  const result = await build({
    entryPoints: [path.join(APP, 'main.ts')],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    minify: !debug,
    sourcemap: debug ? 'inline' : false,
    define: {
      __TAUT_BUNDLED_PLUGINS__: JSON.stringify(plugins),
      __TAUT_VERSION__: JSON.stringify(versions.taut),
      __TAUT_TELEMETRY__: String(telemetry),
      process: 'undefined',
      'import.meta.url': 'self.location.href',
    },
  })

  let code = result.outputFiles[0].text
  // The app is injected as an inline <script>, which DevTools would
  // otherwise attribute to the page (app.slack.com). Naming it with a
  // sourceURL gives the generated script a stable identity under the taut://
  // tree instead of an anonymous inline entry under Slack.
  if (debug) code += `\n//# sourceURL=${TAUT_SOURCE_ORIGIN}app.js\n`
  return code
}

/** Build one flavor of the bundle. Throws if any plugin or the app fails to compile. */
export async function buildTautBundle(
  debug: boolean,
  { telemetry = true } = {}
) {
  const label = debug ? 'debug' : 'production'
  console.log(`[build-taut] Starting ${label} build...`)

  const plugins = await bundlePlugins(debug)
  console.log(`[build-taut] ${Object.keys(plugins).length} plugins bundled`)

  let code = await bundleApp(plugins, debug, telemetry)
  if (debug) code = rewriteInlineSourcemaps(code)

  const outFile = debug ? TAUT_DEBUG_JS : TAUT_JS
  await mkdir(DIST, { recursive: true })
  await writeFile(outFile, code)
  console.log(
    `[build-taut] ${path.basename(outFile)}: ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`
  )
}

export async function buildTaut() {
  await Promise.all([buildTautBundle(false), buildTautBundle(true)])
}
