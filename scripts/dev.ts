#!/usr/bin/env node

// Rebuilds the debug bundle on change and serves it on localhost:3000

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { buildTautBundle } from './build/taut.ts'
import { APP, PLUGINS, ROOT, SHARED, TAUT_DEBUG_JS } from './lib/paths.ts'

let rebuildTimer: ReturnType<typeof setTimeout> | undefined
let currentBuild: Promise<void> | null = null
async function rebuild() {
  if (currentBuild) return currentBuild

  currentBuild = buildTautBundle(true, { telemetry: false }).catch((err) => {
    console.error('[dev] Build failed, watching for changes...', err.message)
  })

  try {
    return await currentBuild
  } finally {
    currentBuild = null
  }
}

await rebuild()
for (const target of [APP, PLUGINS, SHARED, path.join(ROOT, 'package.json')])
  fs.watch(target, { recursive: true }, () => {
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => void rebuild(), 100)
  })

const PORT = 3000
http
  .createServer((req, res) => {
    if (req.url !== '/taut.js') {
      res.writeHead(404).end('Not found')
      return
    }
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(fs.readFileSync(TAUT_DEBUG_JS))
  })
  .listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}/taut.js`)
  })
