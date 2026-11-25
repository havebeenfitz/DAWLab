// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import crypto from 'crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'


import { findParent, projectFilesForPlugins, pluginsOfVersion } from '../version-changes'

let cas: string
const put = (data: Buffer) => {
  const hash = crypto.createHash('sha256').update(data).digest('hex')
  const p = path.join(cas, hash.slice(0, 2), hash.slice(2, 4), hash)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
  return hash
}

const als = (plugins: Array<[string, string, number]>) => {
  const devices = plugins.flatMap(([name, vendor, n]) => Array.from({ length: n }, () => `
    <PluginDevice><BranchDeviceId Value="device:vst3:audiofx:x"/><PluginDesc><Vst3PluginInfo>
      <Name Value="${name}"/><Manufacturer Value="${vendor}"/></Vst3PluginInfo></PluginDesc></PluginDevice>`)).join('')
  const xml = `<?xml version="1.0"?><Ableton MajorVersion="5" MinorVersion="12" Creator="Ableton Live 12.1"><LiveSet>
    <Tracks><AudioTrack><Name><EffectiveName Value="Gtr"/></Name><DeviceChain>${devices}</DeviceChain></AudioTrack></Tracks>
    <MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="98"/></Tempo></Mixer></DeviceChain></MasterTrack></LiveSet></Ableton>`
  return zlib.gzipSync(Buffer.from(xml))
}

const fourcc = (s: string) => s.split('').reduce((n, ch) => n * 256 + ch.charCodeAt(0), 0)
const logicData = (plugins: Array<[string, string, string, number]>) => {
  const frag = (mfr: string, name: string, sub: string) =>
    `\u0000\u0001<dict><key>manufacturer</key><integer>${fourcc(mfr)}</integer><key>name</key><string>${name}</string>` +
    `<key>subtype</key><integer>${fourcc(sub)}</integer><key>type</key><integer>${fourcc('aufx')}</integer></dict>\u0000`
  return Buffer.from(plugins.flatMap(([m, n, s, k]) => Array.from({ length: k }, () => frag(m, n, s))).join('junk'), 'latin1')
}

beforeAll(() => { cas = fs.mkdtempSync(path.join(os.tmpdir(), 'cas-')) })
afterAll(() => fs.rmSync(cas, { recursive: true, force: true }))

describe('findParent', () => {
  const log = {
    branches: [
      { name: 'main', commits: [
        { commit_id: 'a', timestamp: '20260101000000', message: 'first' },
        { commit_id: 'b', timestamp: '20260102000000', message: 'second' },
        { commit_id: 'd', timestamp: '20260104000000', message: 'fourth' },
      ] },
      { name: 'alt', commits: [{ commit_id: 'c', timestamp: '20260103000000', message: 'alt start' }] },
    ],
  }
  it('takes the previous commit on the branch', () => {
    expect(findParent(log, 'b')?.commit_id).toBe('a')
    expect(findParent(log, 'd')?.commit_id).toBe('b')
  })
  it('takes the newest earlier version for a branch start', () => {
    expect(findParent(log, 'c')?.commit_id).toBe('b')
  })
  it('returns null for the first version or an unknown id', () => {
    expect(findParent(log, 'a')).toBeNull()
    expect(findParent(log, 'zz')).toBeNull()
    expect(findParent(null, 'a')).toBeNull()
  })
})

describe('projectFilesForPlugins', () => {
  it('picks Logic ProjectData files, root and alternatives', () => {
    const map = [
      { path: 'Song.logicx/Alternatives/000/ProjectData', hash: '1' },
      { path: 'Song.logicx/Alternatives/001/ProjectData', hash: '2' },
      { path: 'Song.logicx/Resources/ProjectInformation.plist', hash: '3' },
      { path: 'Audio Files/a.wav', hash: '4' },
    ]
    expect(projectFilesForPlugins(map, 'Logic Pro X').map(e => e.hash)).toEqual(['1', '2'])
  })
  it('picks top-level .als files for Ableton, not backups', () => {
    const map = [
      { path: 'Song.als', hash: '1' },
      { path: 'Backup/Song [2026-01-01].als', hash: '2' },
      { path: 'Samples/x.wav', hash: '3' },
    ]
    expect(projectFilesForPlugins(map, 'Ableton Live').map(e => e.hash)).toEqual(['1'])
  })
  it('returns nothing for other DAWs', () => {
    expect(projectFilesForPlugins([{ path: 'a.flp', hash: '1' }], 'FL Studio')).toEqual([])
  })
})

describe('pluginsOfVersion', () => {
  it('reads and counts Ableton plugins straight from storage', () => {
    const hash = put(als([['Pro-Q 3', 'FabFilter', 2], ['Valhalla Room', 'Valhalla DSP', 1]]))
    const plugins = pluginsOfVersion([{ path: 'Song.als', hash }], 'Ableton Live', cas)!
    expect(plugins.map(p => [p.name, p.manufacturer, p.count])).toEqual([
      ['Pro-Q 3', 'FabFilter', 2],
      ['Valhalla Room', 'Valhalla DSP', 1],
    ])
  })

  it('reads and counts Logic plugins, skipping Apple built-ins, merging alternatives', () => {
    const a = put(logicData([['FabF', 'Pro-Q 3', 'FQ3p', 2], ['appl', 'AUDelay', 'dely', 1]]))
    const b = put(logicData([['FabF', 'Pro-Q 3', 'FQ3p', 3], ['Vlhl', 'Room', 'VRm1', 1]]))
    const plugins = pluginsOfVersion([
      { path: 'S.logicx/Alternatives/000/ProjectData', hash: a },
      { path: 'S.logicx/Alternatives/001/ProjectData', hash: b },
    ], 'Logic Pro X', cas)!
    // Without installed AUs to look names up in, the subtype code stands in for the name.
    expect(plugins.map(p => [p.name, p.manufacturer, p.count])).toEqual([['FQ3p', 'FabF', 3], ['VRm1', 'Vlhl', 1]])
  })

  it('returns null when nothing can be read', () => {
    expect(pluginsOfVersion([{ path: 'Song.als', hash: 'f'.repeat(64) }], 'Ableton Live', cas)).toBeNull()
    expect(pluginsOfVersion([], 'Ableton Live', cas)).toBeNull()
    expect(pluginsOfVersion([{ path: 'x.rpp', hash: '1' }], 'Reaper', cas)).toBeNull()
  })
})
