// Taut Desktop Slack downloader

import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { fileURLToPath } from 'node:url'
import { createGunzip } from 'node:zlib'
import { app, BrowserWindow, dialog, net } from 'electron'
import tar from 'tar-stream'
import { downloadedNativesDir } from './nativeModules.js'
import { extractDebDir, extractZipDir } from './slackArchive.js'

declare const __TAUT_SLACK_VERSION__: string
export const SLACK_VERSION = __TAUT_SLACK_VERSION__

const CDN = 'https://downloads.slack-edge.com/desktop-releases'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const slackRoot = () => path.join(app.getPath('appData'), 'Taut', 'slack')
const resourcesDir = () => path.join(slackRoot(), SLACK_VERSION)

export function cachedSlackAsar(): string | undefined {
  const asar = path.join(resourcesDir(), 'app.asar')
  return existsSync(asar) ? asar : undefined
}

function release(): { url: string; resources: string; kind: 'zip' | 'deb' } {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const v = SLACK_VERSION
  switch (process.platform) {
    case 'darwin':
      return {
        url: `${CDN}/mac/${arch}/${v}/Slack-${v}-macOS.zip`,
        resources: 'Slack.app/Contents/Resources',
        kind: 'zip',
      }
    case 'win32':
      return {
        url: `${CDN}/windows/${arch}/${v}/Slack.msix`,
        resources: 'app/resources',
        kind: 'zip',
      }
    default:
      return {
        url: `${CDN}/linux/x64/${v}/slack-desktop-${v}-amd64.deb`,
        resources: './usr/lib/slack/resources',
        kind: 'deb',
      }
  }
}

export type Progress =
  | { phase: 'download'; received: number; total: number }
  | { phase: 'unpack' }

async function download(
  url: string,
  dest: string,
  onProgress: (p: Progress) => void
) {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      onProgress({ phase: 'download', received, total })
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(res.body as ReadableStream),
    counter,
    createWriteStream(dest)
  )
}

/** Download and unpack the pinned Slack. Needs the app to be ready (uses net). */
export async function downloadSlack(
  onProgress: (p: Progress) => void = () => {}
) {
  const { url, resources, kind } = release()
  const root = slackRoot()
  const archive = path.join(root, `${SLACK_VERSION}.download`)
  const work = path.join(root, `${SLACK_VERSION}.partial`)
  await mkdir(root, { recursive: true })
  await rm(work, { recursive: true, force: true })

  console.log(`[Taut] Downloading Slack ${SLACK_VERSION} from ${url}`)
  await download(url, archive, onProgress)
  onProgress({ phase: 'unpack' })
  await (kind === 'deb' ? extractDebDir : extractZipDir)(
    archive,
    resources,
    work
  )
  if (!existsSync(path.join(work, 'app.asar'))) {
    throw new Error(`${url} did not contain ${resources}/app.asar`)
  }
  await downloadSlackNatives(work).catch((err) =>
    console.warn('[Taut] arm64 slack-desktop-utils download failed:', err)
  )
  await rename(work, resourcesDir())
  await rm(work, { recursive: true, force: true })
  await rm(archive, { force: true })
  for (const entry of await readdir(root)) {
    if (entry !== SLACK_VERSION) {
      await rm(path.join(root, entry), { recursive: true, force: true })
    }
  }
  console.log(`[Taut] Slack ${SLACK_VERSION} ready`)
}

// slack publishes N-API prebuilds of its proprietary module for linux arm64
// too, at the node-pre-gyp location described in its package.json
function slackDesktopUtilsPrebuildUrl(slackResourcesPath: string): string {
  const pkg = JSON.parse(
    readFileSync(
      path.join(
        slackResourcesPath,
        'app.asar',
        'node_modules',
        '@tinyspeck',
        'slack-desktop-utils',
        'package.json'
      ),
      'utf8'
    )
  )
  const { binary, version } = pkg
  const fields: Record<string, string> = {
    module_name: binary.module_name,
    version,
    napi_build_version: String(Math.max(...binary.napi_versions)),
    platform: 'linux',
    arch: 'arm64',
  }
  const name = (binary.package_name as string).replace(
    /\{(\w+)\}/g,
    (_, key) => fields[key]
  )
  return `${binary.production_host}/${name}`
}

/**
 * On arm64 linux, fetch the arm64 slack-desktop-utils next to the given Slack
 */
export async function downloadSlackNatives(slackResourcesPath: string) {
  if (process.platform !== 'linux' || process.arch !== 'arm64') return
  const dir = downloadedNativesDir(slackResourcesPath)
  try {
    await access(path.join(dir, 'slackdesktoputils.node'))
    return
  } catch {}
  const url = slackDesktopUtilsPrebuildUrl(slackResourcesPath)
  console.log(`[Taut] Downloading arm64 slack-desktop-utils from ${url}`)
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`)
  await mkdir(dir, { recursive: true })
  const extract = tar.extract()
  extract.on('entry', (header, stream, next) => {
    if (header.type !== 'file' || !header.name.endsWith('.node')) {
      stream.resume()
      stream.on('end', next)
      return
    }
    pipeline(
      stream,
      createWriteStream(path.join(dir, path.basename(header.name)))
    ).then(
      () => next(),
      (err) => extract.destroy(err)
    )
  })
  await pipeline(
    Readable.fromWeb(res.body as ReadableStream),
    createGunzip(),
    extract
  )
  console.log(`[Taut] arm64 slack-desktop-utils ready in ${dir}`)
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(0)

/** First launch, can't find Slack on disk, download with progress window */
export async function downloadSlackWithWindow() {
  const win = new BrowserWindow({
    width: 380,
    height: 110,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Taut',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
  })
  win.setMenu(null)
  win.once('ready-to-show', () => win.show())
  await win.loadFile(path.join(__dirname, 'download.html'))

  let lastUpdate = 0
  const update = (p: Progress) => {
    const now = Date.now()
    if (p.phase === 'download' && now - lastUpdate < 100) return
    lastUpdate = now
    const state =
      p.phase === 'download'
        ? {
            text: `Downloading Slack ${SLACK_VERSION} (${mb(p.received)} of ${mb(p.total)} MB)`,
            value: p.total ? p.received / p.total : null,
          }
        : { text: `Unpacking Slack ${SLACK_VERSION}`, value: null }
    win.webContents
      .executeJavaScript(`update(${JSON.stringify(state)})`)
      .catch(() => {})
  }

  try {
    await downloadSlack(update)
  } catch (err) {
    win.close()
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Taut',
      message: 'Slack could not be downloaded',
      detail: `${String(err)}\n\nCheck your connection, or install the official Slack app, then open Taut again. If this doesn't fix itself, report it in #taut.`,
      buttons: ['Quit'],
    })
    process.exit(1)
  }
  win.close()
}
