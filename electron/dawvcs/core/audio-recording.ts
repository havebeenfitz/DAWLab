/**
 * An audio file the DAW is still recording into. While recording, Logic (and
 * most DAWs) write a placeholder size into the file's header and fill in the
 * real one when the take ends. A version must never keep such a file: it is a
 * half take, and the finished file that replaces it has another length.
 */
import fs from 'fs'
import path from 'path'

const WAV = new Set(['.wav', '.wave', '.bwf'])
const AIFF = new Set(['.aif', '.aiff', '.aifc'])

/** True when the header says the file isn't finished: its declared size doesn't fit the file. */
export function isRecordingInProgress(file: string): boolean {
  const ext = path.extname(file).toLowerCase()
  if (!WAV.has(ext) && !AIFF.has(ext) && ext !== '.caf') return false
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const head = Buffer.alloc(12)
    if (fs.readSync(fd, head, 0, 12, 0) < 12) return false
    const id = head.toString('latin1', 0, 4)
    if (id === 'RIFF') return declaredTooBig(head.readUInt32LE(4), size)
    if (id === 'FORM') return declaredTooBig(head.readUInt32BE(4), size)
    if (id === 'caff') return cafDataUnknown(fd, size)
    return false // RF64 and anything else: no placeholder to check
  } catch {
    return false
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** The container claims more bytes than the file has (a pad byte is allowed). */
const declaredTooBig = (declared: number, fileSize: number) => declared === 0 || declared + 8 > fileSize + 1

/** CAF: the data chunk's size is -1 while recording. */
function cafDataUnknown(fd: number, fileSize: number): boolean {
  let pos = 8
  const header = Buffer.alloc(12)
  for (let i = 0; i < 64 && pos + 12 <= fileSize; i++) {
    if (fs.readSync(fd, header, 0, 12, pos) < 12) return false
    const type = header.toString('latin1', 0, 4)
    const size = header.readBigInt64BE(4)
    if (type === 'data') return size === -1n
    if (size < 0n) return false
    pos += 12 + Number(size)
  }
  return false
}

/** The audio files of a snapshot that are still being recorded, as project-relative paths. */
export function filesStillRecording(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, full]) => full !== 'empty' && isRecordingInProgress(full))
    .map(([rel]) => rel)
}

export class RecordingInProgressError extends Error {
  constructor(public readonly files: string[]) {
    const names = files.map((f) => `“${path.basename(f)}”`).join(', ')
    super(`Your DAW is still recording ${names}. Stop recording, then save the version.`)
    this.name = 'RecordingInProgressError'
  }
}
