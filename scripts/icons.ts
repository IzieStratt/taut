#!/usr/bin/env node

// Optimizes the source logos in place and regenerates the derived icons

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { ASSETS, SERVER } from './lib/paths.ts'

const asset = (...p: string[]) => path.join(ASSETS, ...p)
const toPng = (input: string | Buffer) =>
  sharp(input).png({ compressionLevel: 9, effort: 10 }).toBuffer()

await mkdir(asset('icons'), { recursive: true })

// Optimize both source logos in place
for (const name of ['logo.png', 'logo-macos.png']) {
  await writeFile(asset(name), await toPng(asset(name)))
}

// Extension icon sizes from the logo, plus the served favicon / userscript icon
const logo = await readFile(asset('logo.png'))
for (const size of [16, 32, 48, 128]) {
  await writeFile(
    asset('icons', `icon-${size}.png`),
    await toPng(await sharp(logo).resize(size, size).toBuffer())
  )
}
await writeFile(path.join(SERVER, 'public', 'icon.png'), logo)

console.log('[icons] Done')
