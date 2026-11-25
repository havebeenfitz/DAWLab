// @vitest-environment node
/** Plugin detection: instance counts, the DAWs' own plugins, and which Logic alternative is read. */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { AbletonParser } from '../parser'
import { LogicProParser } from '../logicProParser'
import { abletonDeviceName, logicBuiltinName } from '../builtinPlugins'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-parsers-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const vst3 = (name: string, maker: string, instr = false) => `
  <PluginDevice Id="9"><PluginDesc><Vst3PluginInfo Id="0"><Name Value="${name}"/><Manufacturer Value="${maker}"/></Vst3PluginInfo></PluginDesc>
  <BranchDeviceId Value="device:vst3:${instr ? 'instr' : 'audiofx'}:x"/></PluginDevice>`

function writeAls(file: string, tracksXml: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Ableton MajorVersion="5" MinorVersion="12.0" Creator="Ableton Live 12.1"><LiveSet><Tracks>${tracksXml}</Tracks></LiveSet></Ableton>`
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(xml)))
}

describe('AbletonParser', () => {
  it('counts every instance of plugins and Live devices, including inside racks', async () => {
    const file = path.join(tmp, 'Song.als')
    writeAls(file, `
      <AudioTrack Id="1"><Name><EffectiveName Value="Vox"/></Name><DeviceChain><DeviceChain><Devices>
        <Eq8 Id="1"/><Compressor2 Id="2"/><Eq8 Id="3"/>${vst3('Pro-Q 3', 'FabFilter')}
      </Devices></DeviceChain></DeviceChain></AudioTrack>
      <MidiTrack Id="2"><Name><EffectiveName Value="Keys"/></Name><DeviceChain><DeviceChain><Devices>
        <InstrumentGroupDevice Id="4"><Branches><InstrumentBranch Id="0"><DeviceChain><Devices>
          <OriginalSimpler Id="5"/><Reverb Id="6"/>${vst3('Pro-Q 3', 'FabFilter')}
        </Devices></DeviceChain></InstrumentBranch></Branches></InstrumentGroupDevice>
      </Devices></DeviceChain></DeviceChain></MidiTrack>`)

    const { plugins, total_tracks } = await new AbletonParser().parse(file)
    expect(total_tracks).toBe(2)
    const byName = Object.fromEntries(plugins.map((p) => [p.name, p]))
    expect(byName['Pro-Q 3']).toMatchObject({ manufacturer: 'FabFilter', count: 2, is_instrument: false })
    expect(byName['Pro-Q 3'].builtin).toBeUndefined()
    expect(byName['EQ Eight']).toMatchObject({ builtin: true, count: 2, manufacturer: 'Ableton' })
    expect(byName['Compressor']).toMatchObject({ builtin: true, count: 1 })
    expect(byName['Simpler']).toMatchObject({ builtin: true, is_instrument: true })
    expect(byName['Instrument Rack']).toMatchObject({ builtin: true, is_instrument: true, count: 1 })
    expect(byName['Reverb']).toMatchObject({ count: 1 })
    expect(plugins.find((p) => p.name === 'Plugin Device')).toBeUndefined()
    // Which tracks use what, racks included
    expect(byName['Pro-Q 3'].tracks).toEqual(['Vox', 'Keys'])
    expect(byName['EQ Eight'].tracks).toEqual(['Vox'])
    expect(byName['Simpler'].tracks).toEqual(['Keys'])
  })

  it('names the main track and prefers names the user gave', async () => {
    const file = path.join(tmp, 'Named.als')
    const xml = `<?xml version="1.0"?><Ableton><LiveSet><Tracks>
      <AudioTrack Id="1"><Name><EffectiveName Value="1-Audio"/><UserName Value="Lead vocal"/></Name><DeviceChain><DeviceChain><Devices><Eq8 Id="1"/></Devices></DeviceChain></DeviceChain></AudioTrack>
      </Tracks><MasterTrack><Name><EffectiveName Value="Main"/></Name><DeviceChain><DeviceChain><Devices><Limiter Id="2"/><Eq8 Id="3"/></Devices></DeviceChain></DeviceChain></MasterTrack></LiveSet></Ableton>`
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(xml)))
    const { plugins } = await new AbletonParser().parse(file)
    const byName = Object.fromEntries(plugins.map((p) => [p.name, p]))
    expect(byName['EQ Eight'].tracks).toEqual(['Lead vocal', 'Main'])
    expect(byName['Limiter'].tracks).toEqual(['Main'])
  })

  it('reads uncompressed sets and refuses files that are not Live sets', async () => {
    const file = path.join(tmp, 'Plain.als')
    fs.writeFileSync(file, '<Ableton><LiveSet><Tracks/></LiveSet></Ableton>')
    expect((await new AbletonParser().parse(file)).plugins).toEqual([])
    fs.writeFileSync(file, '<NotAbleton/>')
    await expect(new AbletonParser().parse(file)).rejects.toThrow(/Invalid Ableton/)
  })
})

/** Bytes as Logic writes them: a label, zero padding, then the record tag "GAME". */
const builtinRecord = (label: string, pad = 2) => Buffer.concat([Buffer.alloc(20), Buffer.from([0xa7, 0x04, 0x02, 0x02]), Buffer.from(label, 'latin1'), Buffer.alloc(pad), Buffer.from('GAME....')])
const fourCC = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0
const auFragment = (mfr: string, sub: string, type: string, preset = 'Default') => Buffer.from(
  `<key>manufacturer</key><integer>${fourCC(mfr)}</integer><key>name</key><string>${preset}</string><key>subtype</key><integer>${fourCC(sub)}</integer><key>type</key><integer>${fourCC(type)}</integer>`,
  'latin1',
)

describe('LogicProParser', () => {
  it('finds third-party plugins and Logic’s own, one per instance', async () => {
    const file = path.join(tmp, 'ProjectData')
    fs.writeFileSync(file, Buffer.concat([
      auFragment('FabF', 'FC2p', 'aumf'), Buffer.from('\x00junk\x00'), auFragment('FabF', 'FC2p', 'aumf', 'Other'),
      auFragment('Toon', 'EZd3', 'aumu'),
      auFragment('appl', 'xxxx', 'aufx'), // Apple AU fragments are skipped; Logic's own come from records
      builtinRecord('Channel EQ'), builtinRecord('Channel EQ'), builtinRecord('St-Delay'), builtinRecord('Alchemy', 5),
      builtinRecord('Klopfgeist'), // the metronome, not a plugin
      Buffer.from('Channel EQ text without the record tag'),
    ]))
    const { plugins } = new LogicProParser().parseBuffer(fs.readFileSync(file))
    const byName = Object.fromEntries(plugins.map((p) => [`${p.builtin ? 'b' : 'p'}:${p.name}`, p]))
    // Third-party names come from the Audio Units installed on the machine, so check by kind and count.
    const thirdParty = plugins.filter((p) => !p.builtin).sort((a, b) => (b.count ?? 1) - (a.count ?? 1))
    expect(thirdParty.map((p) => [p.count, p.is_instrument])).toEqual([[2, false], [1, true]])
    expect(byName['b:Channel EQ']).toMatchObject({ count: 2, manufacturer: 'Apple', builtin: true })
    expect(byName['b:Stereo Delay']).toMatchObject({ count: 1 })
    expect(byName['b:Alchemy']).toMatchObject({ is_instrument: true })
    expect(byName['b:Klopfgeist']).toBeUndefined()
    expect(plugins.filter((p) => p.builtin)).toHaveLength(3)
  })

  it('reads the alternative that was saved last', async () => {
    const bundle = path.join(tmp, 'Song.logicx')
    for (const [alt, label] of [['000', 'ChromaVerb'], ['001', 'Tape Delay']] as const) {
      fs.mkdirSync(path.join(bundle, 'Alternatives', alt), { recursive: true })
      fs.writeFileSync(path.join(bundle, 'Alternatives', alt, 'ProjectData'), builtinRecord(label))
    }
    const old = new Date('2026-01-01T00:00:00Z')
    fs.utimesSync(path.join(bundle, 'Alternatives', '000', 'ProjectData'), old, old)
    const { plugins } = await new LogicProParser().parse(bundle)
    expect(plugins.map((p) => p.name)).toEqual(['Tape Delay'])
  })

  it('explains a bundle without project data', async () => {
    const empty = path.join(tmp, 'Empty.logicx')
    fs.mkdirSync(empty, { recursive: true })
    await expect(new LogicProParser().parse(empty)).rejects.toThrow(/No ProjectData/)
  })
})

describe('plugin helpers', () => {
  it('names built-ins the way the DAW shows them', () => {
    expect(logicBuiltinName('Space D')).toBe('Space Designer')
    expect(logicBuiltinName('ChromaVerb')).toBe('ChromaVerb')
    expect(abletonDeviceName('Eq8')).toBe('EQ Eight')
    expect(abletonDeviceName('SomeNewDevice2')).toBe('Some New Device 2')
  })
})
