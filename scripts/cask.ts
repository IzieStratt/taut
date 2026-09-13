#!/usr/bin/env node

// Prints the Homebrew cask for the current desktop version
// Usage: node scripts/cask.ts <taut-mac.dmg> <taut-mac-x64.dmg>

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { versions } from './lib/versions.ts'

const [arm, intel] = process.argv.slice(2)
if (!arm || !intel) {
  console.error('usage: node scripts/cask.ts <taut-mac.dmg> <taut-mac-x64.dmg>')
  process.exit(1)
}
const sha256 = (file: string) =>
  createHash('sha256').update(readFileSync(file)).digest('hex')

process.stdout.write(`cask "taut" do
  arch intel: "-x64"

  version "${versions.desktop}"
  sha256 arm:   "${sha256(arm)}",
         intel: "${sha256(intel)}"

  url "https://github.com/jeremy46231/taut/releases/download/desktop-v#{version}/taut-mac#{arch}.dmg"
  name "Taut"
  desc "Client mod for Slack"
  homepage "https://taut.jer.app/"

  livecheck do
    url :url
    regex(/^desktop[._-]v?(\\d+(?:\\.\\d+)+)$/i)
    strategy :github_releases
  end

  depends_on macos: :monterey

  app "Taut.app"

  zap trash: [
    "~/Library/Application Support/Taut",
    "~/Library/Preferences/app.jer.taut.plist",
    "~/Library/Saved Application State/app.jer.taut.savedState",
  ]
end
`)
