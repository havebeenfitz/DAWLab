/**
 * Logic (and other DAWs) rewrite the header of an audio file when a project
 * opens: waveform overviews, padding, an extra chunk. The sound is the same.
 * These helpers hash only what is heard: the format and the sample data, so a
 * header-only rewrite can be told apart from a real change.
 *
 * WAV/RF64 ("fmt " + "data"), AIFF/AIFC ("COMM" + "SSND") and CAF ("desc" +
 * "data"). Anything else returns null and is compared byte by byte as before.
 */
import fs from 'fs'
import crypto from 'crypto'
import path from 'path'

export const AUDIO_EXT = /\.(wav|wave|aif|aiff|aifc|caf)$/i

interface Span { start: number; length: number }
interface Layout { format: Span; samples: Span }

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len)
  const n = fs.readSync(fd, b, 0, len, pos)
  return n === len ? b : b.subarray(0, n)
}

/** Where the format description and the samples are in the file, or null when it isn't a known audio format. */
export function audioLayout(fd: number, size: number): Layout | null {
  const head = readAt(fd, 0, 12)
  if (head.length < 12) return null
  const id = head.toString('latin1', 0, 4)
  let format: Span | null = null
  let samples: Span | null = null

  if ((id === 'RIFF' || id === 'RF64') && head.toString('latin1', 8, 12) === 'WAVE') {
    let pos = 12
    let dataSize64: number | null = null
    while (pos + 8 <= size) {
      const h = readAt(fd, pos, 8)
      const cid = h.toString('latin1', 0, 4)
      let len = h.readUInt32LE(4)
      if (cid === 'ds64') dataSize64 = Number(readAt(fd, pos + 16, 8).readBigUInt64LE(0))
      if (cid === 'data' && len === 0xffffffff && dataSize64 !== null) len = dataSize64
      if (cid === 'fmt ') format = { start: pos + 8, length: len }
      if (cid === 'data') samples = { start: pos + 8, length: Math.min(len, size - pos - 8) }
      pos += 8 + len + (len & 1)
    }
  } else if (id === 'FORM' && /^AIF[FC]$/.test(head.toString('latin1', 8, 12))) {
    let pos = 12
    while (pos + 8 <= size) {
      const h = readAt(fd, pos, 8)
      const cid = h.toString('latin1', 0, 4)
      const len = h.readUInt32BE(4)
      if (cid === 'COMM') format = { start: pos + 8, length: len }
      if (cid === 'SSND') samples = { start: pos + 8, length: Math.min(len, size - pos - 8) }
      pos += 8 + len + (len & 1)
    }
  } else if (id === 'caff') {
    let pos = 8
    while (pos + 12 <= size) {
      const h = readAt(fd, pos, 12)
      const cid = h.toString('latin1', 0, 4)
      let len = Number(h.readBigInt64BE(4))
      if (len < 0) len = size - pos - 12 // "until the end of the file"
      if (cid === 'desc') format = { start: pos + 12, length: len }
      if (cid === 'data') samples = { start: pos + 12, length: Math.min(len, size - pos - 12) }
      pos += 12 + len
    }
  } else {
    return null
  }
  return format && samples ? { format, samples } : null
}

async function hashSpans(full: string, fd: number, spans: Span[]): Promise<string> {
  const h = crypto.createHash('sha256')
  for (const s of spans) {
    h.update(`${s.length}:`)
    if (s.length === 0) continue
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(full, { fd, start: s.start, end: s.start + s.length - 1, autoClose: false })
        .on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve())
    })
  }
  return h.digest('hex')
}

/** Hash of the format and sample data of an audio file; null when it isn't one we can read. */
export async function sampleHashOfFile(full: string): Promise<string | null> {
  if (!AUDIO_EXT.test(full)) return null
  let fd: number | null = null
  try {
    fd = fs.openSync(full, 'r')
    const size = fs.fstatSync(fd).size
    const layout = audioLayout(fd, size)
    if (!layout) return null
    return await hashSpans(full, fd, [layout.format, layout.samples])
  } catch {
    return null
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch { /* ignore */ }
  }
}

// Working files change; cache by path + size + mtime. Stored blobs never change; cache by content hash, on disk too.
const fileCache = new Map<string, { size: number; mtimeMs: number; hash: string | null }>()
const blobCache = new Map<string, string | null>()
const diskCaches = new Map<string, Record<string, string | null>>()

export async function sampleHashOfWorkingFile(full: string, stat: fs.Stats): Promise<string | null> {
  const c = fileCache.get(full)
  if (c && c.size === stat.size && c.mtimeMs === stat.mtimeMs) return c.hash
  const hash = await sampleHashOfFile(full)
  fileCache.set(full, { size: stat.size, mtimeMs: stat.mtimeMs, hash })
  return hash
}

function diskCache(cacheFile: string): Record<string, string | null> {
  let c = diskCaches.get(cacheFile)
  if (!c) {
    try { c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch { c = {} }
    diskCaches.set(cacheFile, c!)
  }
  return c!
}

/**
 * Sample hash of a stored blob (`blobPath`, content hash `hash`), remembered in
 * `cacheFile` so each stored file is read once. `ext` decides whether it is audio.
 */
export async function sampleHashOfBlob(hash: string, blobPath: string, ext: string, cacheFile?: string): Promise<string | null> {
  if (!AUDIO_EXT.test(ext)) return null
  if (blobCache.has(hash)) return blobCache.get(hash)!
  const disk = cacheFile ? diskCache(cacheFile) : null
  if (disk && hash in disk) { blobCache.set(hash, disk[hash]); return disk[hash] }
  let result: string | null = null
  if (fs.existsSync(blobPath)) {
    let fd: number | null = null
    try {
      fd = fs.openSync(blobPath, 'r')
      const layout = audioLayout(fd, fs.fstatSync(fd).size)
      if (layout) result = await hashSpans(blobPath, fd, [layout.format, layout.samples])
    } catch { result = null } finally { if (fd !== null) try { fs.closeSync(fd) } catch { /* ignore */ } }
  }
  blobCache.set(hash, result)
  if (disk && cacheFile) {
    disk[hash] = result
    try { fs.writeFileSync(cacheFile, JSON.stringify(disk)) } catch { /* a cache only */ }
  }
  return result
}

/** Where the sample hashes of stored audio are remembered, next to the storage. */
export const sampleCacheFile = (casDir: string) => path.join(path.dirname(casDir), 'sample-hashes.json')
