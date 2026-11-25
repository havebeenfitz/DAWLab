// @vitest-environment node
/** Song facts per version: tempo, tracks, key, time signature, sample rate and audio files. */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import crypto from 'crypto'
import { parsePlist } from '../../../workers/bplist'
import { songInfoFromLogicMetadata, songInfoFromAls, songInfoOfVersion } from '../song-info'
import { getCasPath } from '../../core/cas'
import { diffSong, keyName } from '../../../../shared/song-diff'

const fixtures = path.join(__dirname, '../../../workers/__tests__/fixtures')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-song-'))
const cas = path.join(tmp, 'cas')
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Stores bytes in a CAS folder the way DAWLab does and returns the hash. */
function put(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const hash = crypto.createHash('sha256').update(buf).digest('hex')
  const file = getCasPath(hash, cas)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buf)
  return hash
}

const xmlPlist = (entries: Record<string, string | number>) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${
  Object.entries(entries).map(([k, v]) => `<key>${k}</key>${typeof v === 'number' ? `<integer>${v}</integer>` : `<string>${v}</string>`}`).join('')
}<key>AudioFiles</key><array><string>Audio Files/a.wav</string></array></dict></plist>`

const als = (tempo: number, tracks: string, extra = '') => zlib.gzipSync(Buffer.from(
  `<?xml version="1.0"?><Ableton><LiveSet><Tracks>${tracks}</Tracks>
   <MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="${tempo}"/></Tempo>
   <TimeSignature><TimeSignatures><RemoteableTimeSignature Id="0"><Numerator Value="6"/><Denominator Value="8"/></RemoteableTimeSignature></TimeSignatures></TimeSignature>
   </Mixer></DeviceChain></MasterTrack>${extra}</LiveSet></Ableton>`,
))

describe('binary plists', () => {
  it('reads the same values as the XML version, including Unicode, reals and large ints', () => {
    const binary = parsePlist(fs.readFileSync(path.join(fixtures, 'MetaData.bplist')))
    const xml = parsePlist(fs.readFileSync(path.join(fixtures, 'MetaData.xml.plist')))
    expect(binary).toEqual(xml)
    expect(binary).toMatchObject({ BeatsPerMinute: 86, Ratio: 1.5, Big: 5000000000, HasARAPlugins: false })
    expect((binary as any).AudioFiles).toContain('Audio Files/Хз.wav')
  })

  it('refuses truncated data', () => {
    expect(() => parsePlist(Buffer.from('bplist00short'))).toThrow(/too short/)
  })
})

describe('Logic song facts', () => {
  it('come from MetaData.plist', () => {
    expect(songInfoFromLogicMetadata(fs.readFileSync(path.join(fixtures, 'MetaData.bplist')))).toEqual({
      tempo: 86, tracks: 48, key: 'C major', timeSignature: '4/4', sampleRate: 48000,
      audioFiles: ['Audio Files/kick.wav', 'Audio Files/Хз.wav'],
    })
  })

  it('are read from the alternative that changed, else the first one', () => {
    const alt0 = put(xmlPlist({ BeatsPerMinute: 90, NumberOfTracks: 3 }))
    const alt1 = put(xmlPlist({ BeatsPerMinute: 120, NumberOfTracks: 5 }))
    const map = (pd0: string, pd1: string) => [
      { path: 'S.logicx/Alternatives/000/ProjectData', hash: pd0 },
      { path: 'S.logicx/Alternatives/000/MetaData.plist', hash: alt0 },
      { path: 'S.logicx/Alternatives/001/ProjectData', hash: pd1 },
      { path: 'S.logicx/Alternatives/001/MetaData.plist', hash: alt1 },
    ]
    expect(songInfoOfVersion(map('a', 'b'), 'Logic Pro X', cas)?.tempo).toBe(90)
    expect(songInfoOfVersion(map('a', 'c'), 'Logic Pro X', cas, map('a', 'b'))?.tempo).toBe(120)
  })

  it('are null when the project has no readable MetaData.plist', () => {
    expect(songInfoOfVersion([{ path: 'S.logicx/Alternatives/000/ProjectData', hash: 'x' }], 'Logic Pro X', cas)).toBeNull()
    expect(songInfoOfVersion([{ path: 'S.logicx/Alternatives/000/MetaData.plist', hash: 'f'.repeat(64) }], 'Logic Pro X', cas)).toBeNull()
    expect(songInfoOfVersion([{ path: 'x.rpp', hash: '1' }], 'Reaper', cas)).toBeNull()
  })
})

describe('Ableton song facts', () => {
  const tracks = '<AudioTrack Id="1"/><MidiTrack Id="2"/><MidiTrack Id="3"/><ReturnTrack Id="4"/>'
  const samples = `<SampleRef><FileRef><RelativePath Value="Samples/Recorded/vox.wav"/><Path Value="/Users/x/Song/Samples/Recorded/vox.wav"/></FileRef></SampleRef>
    <SampleRef><FileRef><Path Value="/Library/Packs/kick.aif"/></FileRef></SampleRef>`

  it('come from the .als: tempo, tracks, time signature, key and samples', () => {
    const info = songInfoFromAls(als(124.5, tracks, `<ScaleInformation><RootNote Value="9"/><Name Value="Minor"/></ScaleInformation><Clip>${samples}</Clip>`))
    expect(info).toEqual({
      tempo: 124.5, tracks: 4, timeSignature: '6/8', key: 'A minor',
      audioFiles: ['kick.aif', 'Samples/Recorded/vox.wav'],
    })
  })

  it('are read from the top-level set, not backups', () => {
    const main = put(als(100, tracks))
    const backup = put(als(80, tracks))
    expect(songInfoOfVersion([
      { path: 'Backup/Song [2026].als', hash: backup },
      { path: 'Song.als', hash: main },
    ], 'Ableton Live', cas)?.tempo).toBe(100)
  })

  it('explains a file that is not a Live set', () => {
    expect(() => songInfoFromAls(Buffer.from('<NotLive/>'))).toThrow(/Not an Ableton Live set/)
  })
})

describe('song changes', () => {
  const base = { tempo: 86, tracks: 46, key: 'C major', timeSignature: '4/4', sampleRate: 44100, audioFiles: ['a.wav', 'b.wav'] }

  it('lists what changed, in a fixed order, and audio files added and removed', () => {
    const diff = diffSong(base, { ...base, tempo: 90, tracks: 48, key: 'D minor', sampleRate: 48000, audioFiles: ['b.wav', 'c.wav'] })
    expect(diff.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`)).toEqual([
      'Tempo: 86 BPM → 90 BPM', 'Tracks: 46 → 48', 'Key: C major → D minor', 'Sample rate: 44.1 kHz → 48 kHz',
    ])
    expect(diff.audioAdded).toEqual(['c.wav'])
    expect(diff.audioRemoved).toEqual(['a.wav'])
  })

  it('reports nothing for a first version, for identical songs, or for values only one side knows', () => {
    expect(diffSong(null, base)).toEqual({ changes: [], audioAdded: [], audioRemoved: [] })
    expect(diffSong(base, { ...base })).toEqual({ changes: [], audioAdded: [], audioRemoved: [] })
    expect(diffSong({ tempo: 86 }, { tempo: 86, tracks: 4, audioFiles: ['x.wav'] })).toEqual({ changes: [], audioAdded: [], audioRemoved: [] })
    expect(diffSong({ tempo: 120 }, { tempo: 119.996 }).changes).toEqual([])
    expect(diffSong({ tempo: 120 }, { tempo: 120.5 }).changes[0].after).toBe('120.5 BPM')
  })

  it('names keys from Ableton root notes', () => {
    expect(keyName(0, 'Major')).toBe('C major')
    expect(keyName(6, '')).toBe('F#')
    expect(keyName(12, 'Major')).toBeUndefined()
    expect(keyName(undefined, 'Major')).toBeUndefined()
  })
})
