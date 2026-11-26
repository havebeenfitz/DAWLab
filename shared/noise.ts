/**
 * Files a DAW or macOS rewrites on every save that say nothing about the
 * music: undo history, autosaves, Finder metadata, DAWLab's own storage.
 * They are not stored in new versions and never shown as changes.
 * Dependency-free: used by the app, the desktop main process and tests.
 */
const NOISE_DIRS = new Set(['Undo Data.nosync', 'Autosave', 'Project File Backups', 'Backup', '.dawlabproject', '.dawlab'])
const NOISE_FILES = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db', '.dawlab-metadata-debug.json'])

/** True when a project-relative path (with `/` separators) is noise. */
export function isNoisePath(relPath: string): boolean {
  const parts = relPath.split('/')
  const name = parts[parts.length - 1]
  if (NOISE_DIRS.has(name) || NOISE_FILES.has(name) || name.startsWith('._')) return true
  return parts.slice(0, -1).some((dir) => NOISE_DIRS.has(dir) || dir.endsWith('.nosync'))
}

/** True when a directory with this name should not be walked at all. */
export function isNoiseDir(name: string): boolean {
  return NOISE_DIRS.has(name) || name.endsWith('.nosync')
}

/**
 * Logic's window layout, thumbnail and preview movie: rewritten on every save
 * without any change to the song. They are stored and transferred like any
 * file (the project must open exactly as it was), but never shown as changes.
 */
const LAYOUT_FILES = new Set(['DisplayState.plist', 'DisplayStateArchive', 'WindowImage.jpg', 'PreviewMovie.mp4'])

export function isLayoutPath(relPath: string): boolean {
  const parts = relPath.split('/')
  return LAYOUT_FILES.has(parts[parts.length - 1]) && parts.some((p) => p.endsWith('.logicx'))
}
