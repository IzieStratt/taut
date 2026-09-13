// macOS code signing and notarization for the desktop build

import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** electron-builder's identity for an ad-hoc signature */
export const AD_HOC = '-'

export function findDeveloperId(identities: string): string | undefined {
  return identities
    .split('\n')
    .map((line) => line.match(/"Developer ID Application: ([^"]+)"/)?.[1])
    .find((name) => name !== undefined)
}

export function resolveMacIdentity(): string {
  try {
    const identities = execFileSync(
      'security',
      ['find-identity', '-v', '-p', 'codesigning'],
      { encoding: 'utf8' }
    )
    return findDeveloperId(identities) ?? AD_HOC
  } catch {
    // `security` unavailable or no identities
    return AD_HOC
  }
}

export function signingMarker(identity: string): string {
  const team = identity.match(/\(([A-Z0-9]+)\)$/)?.[1]
  return team ? `team:${team}` : `adhoc:${Date.now().toString(36)}`
}

export function resolveNotarytoolArgs(): string[] | null {
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) return null
  return [
    '--key',
    APPLE_API_KEY,
    '--key-id',
    APPLE_API_KEY_ID,
    '--issuer',
    APPLE_API_ISSUER,
  ]
}

export function notarizeDmg(file: string, notarytoolArgs: string[]) {
  console.log(`[build-desktop] Notarizing ${path.basename(file)}...`)
  execFileSync(
    'xcrun',
    ['notarytool', 'submit', file, ...notarytoolArgs, '--wait'],
    { stdio: 'inherit' }
  )
  execFileSync('xcrun', ['stapler', 'staple', file], { stdio: 'inherit' })
}
