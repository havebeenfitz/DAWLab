import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isRecordingInProgress } from '../audio-recording'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-rec-'))
const write = (name: string, b: Buffer) => { const f = path.join(dir, name); fs.writeFileSync(f, b); return f }

function riff(declared: number, total = 64) {
  const b = Buffer.alloc(total); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(declared, 4); b.write('WAVE', 8, 'latin1'); return b
}
function form(declared: number, total = 64) {
  const b = Buffer.alloc(total); b.write('FORM', 0, 'latin1'); b.writeUInt32BE(declared, 4); b.write('AIFF', 8, 'latin1'); return b
}
function caf(dataSize: bigint) {
  const b = Buffer.alloc(8 + 12 + 4 + 12 + 16)
  b.write('caff', 0, 'latin1'); b.writeUInt16BE(1, 4)
  b.write('desc', 8, 'latin1'); b.writeBigInt64BE(4n, 12)
  b.write('data', 24, 'latin1'); b.writeBigInt64BE(dataSize, 28)
  return b
}

describe('a take still being recorded', () => {
  it('finished WAV and AIFF files are not', () => {
    expect(isRecordingInProgress(write('a.wav', riff(56)))).toBe(false)
    expect(isRecordingInProgress(write('a.aif', form(56)))).toBe(false)
    expect(isRecordingInProgress(write('odd.aiff', form(57, 65)))).toBe(false) // pad byte
  })
  it('a header with a placeholder size is', () => {
    expect(isRecordingInProgress(write('b.wav', riff(0xfffffff0)))).toBe(true)
    expect(isRecordingInProgress(write('c.wav', riff(0)))).toBe(true)
    expect(isRecordingInProgress(write('bass amp #53.aif', form(2_130_000_000)))).toBe(true)
  })
  it('CAF with an unknown data size is', () => {
    expect(isRecordingInProgress(write('d.caf', caf(-1n)))).toBe(true)
    expect(isRecordingInProgress(write('e.caf', caf(16n)))).toBe(false)
  })
  it('an old file with a broken header is not: nobody is recording into it', () => {
    const f = write('old.wav', riff(0xfffffff0))
    const hourAgo = new Date(Date.now() - 3600_000)
    fs.utimesSync(f, hourAgo, hourAgo)
    expect(isRecordingInProgress(f)).toBe(false)
  })
  it('other files are never checked', () => {
    expect(isRecordingInProgress(write('Song.als', riff(0)))).toBe(false)
    expect(isRecordingInProgress(path.join(dir, 'missing.wav'))).toBe(false)
  })
})
