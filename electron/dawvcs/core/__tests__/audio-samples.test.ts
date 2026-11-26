import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sampleHashOfFile, sampleHashOfBlob } from '../audio-samples'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-samples-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const chunk = (id: string, body: Buffer, le = true) => {
  const h = Buffer.alloc(8)
  h.write(id, 0, 'latin1')
  if (le) h.writeUInt32LE(body.length, 4)
  else h.writeUInt32BE(body.length, 4)
  return Buffer.concat([h, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
}
function wav(samples: Buffer, extra: Buffer[] = []) {
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(48000, 4); fmt.writeUInt32LE(96000, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14)
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), chunk('fmt ', fmt), ...extra, chunk('data', samples)])
  return chunk('RIFF', body).subarray(0, 8 + body.length)
}
function aiff(samples: Buffer, extra: Buffer[] = []) {
  const comm = Buffer.alloc(18)
  comm.writeUInt16BE(1, 0); comm.writeUInt32BE(samples.length / 2, 2); comm.writeUInt16BE(16, 6)
  const ssnd = Buffer.concat([Buffer.alloc(8), samples])
  const body = Buffer.concat([Buffer.from('AIFF', 'latin1'), chunk('COMM', comm, false), ...extra, chunk('SSND', ssnd, false)])
  return chunk('FORM', body, false).subarray(0, 8 + body.length)
}
const write = (name: string, b: Buffer) => { const p = path.join(dir, name); fs.writeFileSync(p, b); return p }
const sound = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0])
const other = Buffer.from([1, 0, 2, 0, 3, 0, 5, 0])

describe('sampleHashOfFile', () => {
  it('ignores a WAV header rewrite (an overview chunk added) and sees a sample change', async () => {
    const a = await sampleHashOfFile(write('a.wav', wav(sound)))
    const b = await sampleHashOfFile(write('b.wav', wav(sound, [chunk('LGWV', Buffer.alloc(33, 7))])))
    const c = await sampleHashOfFile(write('c.wav', wav(other)))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })
  it('does the same for AIFF', async () => {
    const a = await sampleHashOfFile(write('a.aif', aiff(sound)))
    const b = await sampleHashOfFile(write('b.aif', aiff(sound, [chunk('APPL', Buffer.alloc(12, 1), false)])))
    expect(b).toBe(a)
    expect(await sampleHashOfFile(write('c.aif', aiff(other)))).not.toBe(a)
  })
  it('returns null for files that aren’t readable audio', async () => {
    expect(await sampleHashOfFile(write('x.txt', Buffer.from('hello')))).toBeNull()
    expect(await sampleHashOfFile(write('broken.wav', Buffer.from('RIFF....')))).toBeNull()
  })
})

describe('sampleHashOfBlob', () => {
  it('remembers stored files on disk', async () => {
    const blob = write('blob', wav(sound))
    const cache = path.join(dir, 'sample-hashes.json')
    const h = await sampleHashOfBlob('abc123', blob, '.wav', cache)
    expect(JSON.parse(fs.readFileSync(cache, 'utf8'))).toEqual({ abc123: h })
    expect(await sampleHashOfBlob('nope', blob, '.mid', cache)).toBeNull()
  })
})
