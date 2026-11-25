/**
 * Where an audio file of a version is stored, so it can be played exactly as
 * it was in that version (also when it changed or was deleted since).
 */
import fs from 'fs'
import path from 'path'
import { getCommitFileMap } from '../core/commits'
import { getCasPath } from '../core/cas'
import { getProjectStorageDirs } from '../core/storage-location'

/** Audio formats the app's player decodes. */
export const PLAYABLE_AUDIO = new Set(['.wav', '.mp3', '.aif', '.aiff', '.m4a', '.flac', '.ogg'])

export function findVersionAudio(projectName: string, commitId: string, relPath: string): { file: string; extension: string } | null {
  const extension = path.extname(String(relPath)).toLowerCase()
  if (!PLAYABLE_AUDIO.has(extension)) return null
  const { commitsDir, casDir } = getProjectStorageDirs(projectName)
  const entry = getCommitFileMap(projectName, commitId, commitsDir).find((e) => e.path === relPath)
  if (!entry || entry.hash === 'empty') return null
  const file = getCasPath(entry.hash, casDir)
  return fs.existsSync(file) ? { file, extension } : null
}
