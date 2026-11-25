/**
 * Progress of moving files to or from a DAWLab server: how many files, how
 * many bytes, which file now. Pure and dependency-free (app, main process, tests).
 */

export type TransferPhase = 'download' | 'upload'

export interface TransferProgress {
  phase: TransferPhase
  /** 1-based index of the file being moved. */
  fileIndex: number
  fileCount: number
  /** Name of the file being moved, when known. */
  fileName?: string
  bytesDone: number
  /** Sum of the sizes known so far; may grow while files are learned. */
  bytesTotal: number
}

export interface TransferFile {
  size?: number | null
  name?: string
}

export interface TransferTracker {
  /** Starts file `index` (0-based); `size` fills in a size that wasn't known up front. */
  startFile(index: number, size?: number | null): void
  /** The current file's size, once known (e.g. from Content-Length). */
  knowSize(size: number): void
  addBytes(n: number): void
  /** Sends the last state right away (end of the transfer). */
  flush(): void
}

/** Events per second at most, so the window isn't flooded. */
export const PROGRESS_INTERVAL_MS = 100

/**
 * Counts bytes across `files` and calls `emit` at most every `intervalMs`
 * (the first event and file starts go out at once, so the name is never stale).
 */
export function createTransferTracker(
  phase: TransferPhase,
  files: TransferFile[],
  emit: (p: TransferProgress) => void,
  opts: { intervalMs?: number; now?: () => number } = {},
): TransferTracker {
  const intervalMs = opts.intervalMs ?? PROGRESS_INTERVAL_MS
  const now = opts.now ?? Date.now
  const sizes = files.map((f) => (typeof f.size === 'number' && f.size >= 0 ? f.size : null))
  let index = 0
  let done = 0
  let last = -Infinity
  let pending = false

  const total = () => sizes.reduce<number>((s, v) => s + (v ?? 0), 0)
  const state = (): TransferProgress => ({
    phase,
    fileIndex: Math.min(index + 1, Math.max(files.length, 1)),
    fileCount: files.length,
    fileName: files[index]?.name,
    bytesDone: done,
    bytesTotal: Math.max(total(), done),
  })
  const send = () => { last = now(); pending = false; emit(state()) }

  return {
    startFile(i, size) {
      index = i
      if (sizes[i] === null && typeof size === 'number' && size >= 0) sizes[i] = size
      send()
    },
    knowSize(size) {
      if (sizes[index] === null && size >= 0) sizes[index] = size
    },
    addBytes(n) {
      done += n
      if (now() - last >= intervalMs) send()
      else pending = true
    },
    flush() {
      if (pending || last === -Infinity) send()
    },
  }
}

const MB = 1024 * 1024

/** "12.4 of 126 MB" (or KB for small transfers). */
export function formatTransferBytes(done: number, total: number): string {
  const unit = total >= MB ? MB : 1024
  const name = unit === MB ? 'MB' : 'KB'
  const fmt = (n: number) => {
    const v = n / unit
    return v >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)
  }
  return `${fmt(Math.min(done, total))} of ${fmt(total)} ${name}`
}

/** 0–100, rounded down so 100 only shows when everything is there. */
export function transferPercent(p: Pick<TransferProgress, 'bytesDone' | 'bytesTotal'>): number {
  if (p.bytesTotal <= 0) return 0
  return Math.min(100, Math.floor((p.bytesDone / p.bytesTotal) * 100))
}

/** One line for a status bar: "Downloading kick.wav · 3 of 12 · 12.4 of 126 MB". */
export function describeTransfer(p: TransferProgress): string {
  const verb = p.phase === 'download' ? 'Downloading' : 'Uploading'
  const what = p.fileName ? ` ${p.fileName}` : ''
  const count = p.fileCount > 1 ? ` · ${p.fileIndex} of ${p.fileCount}` : ''
  return `${verb}${what}${count} · ${formatTransferBytes(p.bytesDone, p.bytesTotal)}`
}
