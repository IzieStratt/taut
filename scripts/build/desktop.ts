// Builds and packages the Taut desktop app with electron-builder

import { access, cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  Arch,
  type Configuration,
  build as electronBuild,
  Platform,
} from 'electron-builder'
import { build } from 'esbuild'
import {
  DESKTOP_PLATFORMS,
  desktopArtifactStem,
  INSTALLER_EXTENSIONS,
  type PlatformKey,
  type Variant,
  variantSuffix,
} from '../lib/artifacts.ts'
import { commandExists } from '../lib/fs.ts'
import {
  AD_HOC,
  notarizeDmg,
  resolveMacIdentity,
  resolveNotarytoolArgs,
  signingMarker,
} from '../lib/macSigning.ts'
import { nativesDir, SLACK_NATIVE_MODULES } from '../lib/natives.ts'
import { renderOptions } from '../lib/options.ts'
import { ASSETS, DESKTOP, DIST, TAUT_DEBUG_JS } from '../lib/paths.ts'
import { ensureSlackSounds } from '../lib/slackSounds.ts'
import { versions } from '../lib/versions.ts'

const APP_ID = 'app.jer.taut'
const SRC = path.join(DESKTOP, 'src')
const OUT = path.join(DIST, 'desktop')
const BUILD_ROOT = path.join(DESKTOP, 'build')
const STAGE = path.join(BUILD_ROOT, 'app')
const ICON = path.join(ASSETS, 'logo.png')
const MAC_ICON = path.join(ASSETS, 'logo-macos.png')
const MAC_ENTITLEMENTS = path.join(DESKTOP, 'entitlements.mac.plist')
const MAC_ENTITLEMENTS_INHERIT = path.join(
  DESKTOP,
  'entitlements.mac.inherit.plist'
)

const ELECTRON_PLATFORMS = {
  mac: Platform.MAC,
  win: Platform.WINDOWS,
  linux: Platform.LINUX,
}
const ELECTRON_ARCHES = { x64: Arch.x64, arm64: Arch.arm64 }

const INSTALLER_EXT = new RegExp(`\\.(${INSTALLER_EXTENSIONS.join('|')})$`, 'i')

// Stage the variant's compiled JS into desktop/build/app/

export async function buildDesktopJs(
  variant: Variant,
  macIdentity = resolveMacIdentity()
) {
  const isEmbedded = variant === 'embedded'
  const define = {
    __TAUT_EMBEDDED__: String(isEmbedded),
    __TAUT_LOADER_VERSION__: JSON.stringify(versions.desktop),
    __TAUT_SLACK_VERSION__: JSON.stringify(versions.slack),
    __TAUT_APP_ID__: JSON.stringify(APP_ID),
    __TAUT_MAC_SIGNING__: JSON.stringify(signingMarker(macIdentity)),
  }

  await rm(STAGE, { recursive: true, force: true })
  await mkdir(STAGE, { recursive: true })

  const entries = [
    { entry: 'preload.ts', out: 'preload.js', format: 'cjs' },
    { entry: 'options/preload.cjs', out: 'options-preload.js', format: 'cjs' },
    { entry: 'main.ts', out: 'main.js', format: 'esm' },
  ] as const

  // commonjs dependencies of the esm main bundle still call require('electron')
  const esmRequire =
    "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);"

  await Promise.all(
    entries.map(({ entry, out, format }) =>
      build({
        entryPoints: [path.join(SRC, entry)],
        outfile: path.join(STAGE, out),
        bundle: true,
        platform: 'node',
        format,
        define,
        external: ['electron'],
        banner: format === 'esm' ? { js: esmRequire } : {},
      })
    )
  )

  const options = await renderOptions('electron', isEmbedded)
  await writeFile(path.join(STAGE, 'options.html'), options.html)
  await writeFile(path.join(STAGE, 'options.js'), options.js)
  await cp(ICON, path.join(STAGE, 'icon.png'))
  await cp(path.join(SRC, 'download.html'), path.join(STAGE, 'download.html'))
}

// arm64 linux runs slack's x64 javascript with rebuilt native modules
const needsNatives = (key: PlatformKey) =>
  DESKTOP_PLATFORMS[key].os === 'linux' &&
  DESKTOP_PLATFORMS[key].arch === 'arm64'

async function assertNatives(key: PlatformKey) {
  const dir = nativesDir(key)
  for (const m of SLACK_NATIVE_MODULES) {
    try {
      await access(path.join(dir, m.file))
    } catch {
      throw new Error(
        `${key} needs ${path.relative(DESKTOP, dir)}/${m.file}, build it with \`npm run build:natives\` on arm64 linux (CI does this)`
      )
    }
  }
}

// electron-builder config per (variant, platform)

function makeConfig(
  variant: Variant,
  key: PlatformKey,
  mac: { identity: string; notarize: boolean; sounds: string | null }
): Configuration {
  const isEmbedded = variant === 'embedded'
  const suffix = variantSuffix(variant)

  return {
    appId: APP_ID,
    productName: 'Taut',
    electronVersion: versions.electron,
    toolsets: { wine: '1.0.1' },
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    directories: { output: path.join(BUILD_ROOT, 'builder', variant) },
    files: [
      'package.json',
      { from: 'build/app', to: 'build/app', filter: ['**/*'] },
    ],
    extraMetadata: {
      name: `taut${suffix}`,
      main: 'build/app/main.js',
      desktopName: 'taut.desktop',
      ...(isEmbedded
        ? {
            description: `Client mod for Slack (with embedded app v${versions.taut})`,
            version: `${versions.desktop}-embedded-${versions.taut}`,
          }
        : {}),
    },
    extraResources: [
      ...(isEmbedded ? [{ from: TAUT_DEBUG_JS, to: 'taut.js' }] : []),
      ...(needsNatives(key)
        ? [{ from: path.relative(DESKTOP, nativesDir(key)), to: 'native' }]
        : []),
      ...(mac.sounds
        ? [
            {
              from: path.relative(DESKTOP, mac.sounds),
              to: '.',
              filter: ['*.mp3'],
            },
          ]
        : []),
    ],
    protocols: [{ name: 'Slack URL', schemes: ['slack'], role: 'Viewer' }],
    artifactName: `${desktopArtifactStem(key, variant)}.\${ext}`,
    mac: {
      icon: MAC_ICON,
      category: 'public.app-category.productivity',
      identity: mac.identity,
      forceCodeSigning: true,
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: MAC_ENTITLEMENTS,
      entitlementsInherit: MAC_ENTITLEMENTS_INHERIT,
      notarize: mac.notarize,
      extendInfo: {
        NSCameraUsageDescription:
          'This app requires camera access to make video calls from your Slack workspaces.',
        NSMicrophoneUsageDescription:
          'This app requires microphone access to make video calls from your Slack workspaces.',
        NSAudioCaptureUsageDescription:
          'This app needs access to audio capture',
        NSBluetoothAlwaysUsageDescription: 'This app needs access to Bluetooth',
        NSDownloadsFolderUsageDescription:
          'This app saves downloaded files to your Downloads folder.',
      },
    },
    dmg: { sign: true },
    win: { icon: ICON },
    linux: {
      icon: ICON,
      category: 'Utility',
    },
  }
}

// Package one variant for the given platforms, move installers to dist/

async function packageVariant(variant: Variant, platforms: PlatformKey[]) {
  console.log(
    `[build-desktop] Building ${variant} [${platforms.join(', ')}]...`
  )
  const identity = resolveMacIdentity()
  const notarytool = identity === AD_HOC ? null : resolveNotarytoolArgs()
  await buildDesktopJs(variant, identity)

  await rm(path.join(BUILD_ROOT, 'builder', variant), {
    recursive: true,
    force: true,
  })
  await mkdir(OUT, { recursive: true })

  for (const key of platforms) {
    const def = DESKTOP_PLATFORMS[key]
    if (needsNatives(key)) await assertNatives(key)
    const sounds = def.os === 'mac' ? await ensureSlackSounds() : null
    if (def.os === 'mac') {
      console.log(
        identity === AD_HOC
          ? '[build-desktop] macOS signing: ad-hoc'
          : `[build-desktop] macOS signing: Developer ID "${identity}"${notarytool ? '' : ', NOT notarized (set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, see .env.example)'}`
      )
    }
    // claude's explanation of this weird workaround:
    // electron-builder picks a per-file 7z filter, and for arm64 that's the
    // arm64 filter from 7-zip 21.03+, which the 2019-era nsis7z.dll it bundles
    // can't extract, so the installer silently ships without Taut.exe
    // forcing BCJ keeps the archive readable by that old extractor on every arch
    if (def.os === 'win') {
      process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ'
    } else {
      delete process.env.ELECTRON_BUILDER_7Z_FILTER
    }

    let targets = def.targets
    if (targets.includes('rpm') && !commandExists('rpmbuild')) {
      console.warn('[build-desktop] rpmbuild not found, skipping rpm')
      targets = targets.filter((t) => t !== 'rpm')
    }

    const artifacts = await electronBuild({
      projectDir: DESKTOP,
      targets: ELECTRON_PLATFORMS[def.os].createTarget(
        targets,
        ELECTRON_ARCHES[def.arch]
      ),
      publish: 'never',
      config: makeConfig(variant, key, {
        identity,
        notarize: notarytool !== null,
        sounds,
      }),
    })

    for (const artifact of artifacts) {
      const name = path.basename(artifact)
      if (!INSTALLER_EXT.test(name)) continue
      const dest = path.join(OUT, name)
      await rename(artifact, dest)
      if (notarytool && name.endsWith('.dmg')) notarizeDmg(dest, notarytool)
      console.log(`[build-desktop] dist/desktop/${name}`)
    }
  }
}

export async function buildDesktop(
  platforms: PlatformKey[],
  variants: Variant[]
) {
  try {
    for (const variant of variants) {
      await packageVariant(variant, platforms)
    }
  } finally {
    await rm(BUILD_ROOT, { recursive: true, force: true })
  }
}
