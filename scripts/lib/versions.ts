import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DESKTOP, EXTENSION, ROOT, USERSCRIPT } from './paths.ts'

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const rootPkg = json(path.join(ROOT, 'package.json'))

const electron: string = rootPkg.devDependencies.electron
if (!/^\d/.test(electron)) {
  throw new Error(
    `electron must be pinned to an exact version in package.json, got "${electron}"`
  )
}

export const versions = {
  /** The taut.js app bundle */
  taut: rootPkg.version as string,
  electron,
  desktop: json(path.join(DESKTOP, 'package.json')).version as string,
  chromeExtension: json(path.join(EXTENSION, 'chrome', 'manifest.json'))
    .version as string,
  firefoxExtension: json(path.join(EXTENSION, 'firefox', 'manifest.json'))
    .version as string,
  userscript: json(path.join(USERSCRIPT, 'version.json')).version as string,
}
