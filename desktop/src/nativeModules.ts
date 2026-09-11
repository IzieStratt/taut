// Taut Desktop native module loading
// Slack's main process dlopens a handful of .node files from app.asar.unpacked,
// this redirects those where the copies Slack ships can't be used

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { configDir } from './paths.js'

const cjsRequire = createRequire(import.meta.url)
const NodeModule = cjsRequire('module') as any

// captured before patch.ts points resourcesPath at slack's
const realResourcesPath = process.resourcesPath

type NodeLoader = (module: any, filename: string) => void

function wrapNodeLoader(pick: (filename: string) => string) {
  const orig: NodeLoader = NodeModule._extensions['.node']
  NodeModule._extensions['.node'] = function (module: any, filename: string) {
    return orig.call(this, module, pick(filename))
  }
}

// msstore or msix slack stores native addons in WindowsApps, where only
// Slack.exe can execute them but anyone can read them: copy them somewhere
// loadable and load from there instead
function stageWindowsApps() {
  const programFiles = process.env.ProgramFiles ?? process.env.ProgramW6432
  if (!programFiles) return
  const windowsApps = path.join(programFiles, 'WindowsApps').toLowerCase()
  wrapNodeLoader((filename) => {
    if (!filename.toLowerCase().startsWith(windowsApps)) return filename
    const cacheDir = path.join(
      configDir(),
      'native-cache',
      createHash('sha1').update(filename).digest('hex').slice(0, 16)
    )
    const cachedFile = path.join(cacheDir, path.basename(filename))
    if (!existsSync(cachedFile)) {
      mkdirSync(cacheDir, { recursive: true })
      const srcDir = path.dirname(filename)
      for (const name of readdirSync(srcDir)) {
        const srcFile = path.join(srcDir, name)
        if (!statSync(srcFile).isFile()) continue
        copyFileSync(srcFile, path.join(cacheDir, name))
      }
      console.log(`[Taut] Staged WindowsApps native module: ${filename}`)
    }
    return cachedFile
  })
}

export const downloadedNativesDir = (slackResourcesPath: string) =>
  path.join(slackResourcesPath, 'taut-native')

// slack only ships x64 linux builds, so on arm64 its .node files are swapped
// for the arm64 copies the taut build carries (scripts/lib/natives.ts) or the
// prebuild downloaded with slack
function swapLinuxArm64(slackResourcesPath: string) {
  const dirs = [
    downloadedNativesDir(slackResourcesPath),
    path.join(realResourcesPath, 'native'),
  ]
  wrapNodeLoader((filename) => {
    if (!filename.startsWith(slackResourcesPath)) return filename
    const name = path.basename(filename)
    for (const dir of dirs) {
      const candidate = path.join(dir, name)
      if (existsSync(candidate)) {
        console.log(`[Taut] Loading arm64 ${name} from ${dir}`)
        return candidate
      }
    }
    console.warn(
      `[Taut] No arm64 build of ${name}, Slack's x64 copy will fail to load`
    )
    return filename
  })
}

export function redirectNativeModules(slackResourcesPath: string) {
  if (process.platform === 'win32') stageWindowsApps()
  if (process.platform === 'linux' && process.arch === 'arm64') {
    swapLinuxArm64(slackResourcesPath)
  }
}
