import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const readJson = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8'))

/** Whether an executable of this name is on PATH */
export const commandExists = (name: string) =>
  (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => dir && existsSync(path.join(dir, name)))
