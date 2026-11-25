/**
 * The song-level facts of a version (tempo, tracks, key, time signature,
 * sample rate, audio files used) and what changed between two versions.
 * Pure and dependency-free: shared by the app, the main process and tests.
 */

export interface SongInfo {
  /** Beats per minute. */
  tempo?: number
  tracks?: number
  /** "C major", "F# minor"… */
  key?: string
  /** "4/4", "6/8"… */
  timeSignature?: string
  /** Hz */
  sampleRate?: number
  /** Audio files the song uses, as stored in the project (project-relative where possible). */
  audioFiles?: string[]
}

export type SongField = 'tempo' | 'tracks' | 'key' | 'timeSignature' | 'sampleRate'

export interface SongChange {
  field: SongField
  label: string
  before: string
  after: string
}

export interface SongDiff {
  /** Tempo, tracks, key… that differ, in that order. */
  changes: SongChange[]
  audioAdded: string[]
  audioRemoved: string[]
}

const FIELDS: Array<{ field: SongField; label: string; format: (v: SongInfo) => string | undefined }> = [
  { field: 'tempo', label: 'Tempo', format: (s) => (s.tempo ? `${round(s.tempo)} BPM` : undefined) },
  { field: 'tracks', label: 'Tracks', format: (s) => (s.tracks !== undefined ? String(s.tracks) : undefined) },
  { field: 'key', label: 'Key', format: (s) => s.key || undefined },
  { field: 'timeSignature', label: 'Time signature', format: (s) => s.timeSignature || undefined },
  { field: 'sampleRate', label: 'Sample rate', format: (s) => (s.sampleRate ? `${s.sampleRate / 1000} kHz` : undefined) },
]

const round = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2).replace(/0$/, ''))

/** What changed in the song from `before` to `after`. With no `before` (first version) nothing is a change. */
export function diffSong(before: SongInfo | null, after: SongInfo): SongDiff {
  if (!before) return { changes: [], audioAdded: [], audioRemoved: [] }
  const changes: SongChange[] = []
  for (const f of FIELDS) {
    const a = f.format(before)
    const b = f.format(after)
    // A value only one side knows says nothing about a change (older files may lack it).
    if (a !== undefined && b !== undefined && a !== b) changes.push({ field: f.field, label: f.label, before: a, after: b })
  }
  const prev = new Set(before.audioFiles ?? [])
  const next = new Set(after.audioFiles ?? [])
  const known = before.audioFiles !== undefined && after.audioFiles !== undefined
  return {
    changes,
    audioAdded: known ? [...next].filter((f) => !prev.has(f)).sort((x, y) => x.localeCompare(y)) : [],
    audioRemoved: known ? [...prev].filter((f) => !next.has(f)).sort((x, y) => x.localeCompare(y)) : [],
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "C major" from a root note number (0 = C) and a scale name, as Ableton stores them. */
export function keyName(root: number | undefined, scale: string | undefined): string | undefined {
  if (root === undefined || root < 0 || root > 11) return undefined
  const s = (scale ?? '').trim().toLowerCase()
  return s ? `${NOTE_NAMES[root]} ${s}` : NOTE_NAMES[root]
}
