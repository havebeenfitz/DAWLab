// @vitest-environment node
/** Discard changes: back to the last saved version, with what's replaced going to the Trash. */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'

const { MOCK_HOME } = vi.hoisted(() => {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  return { MOCK_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-discard-')) as string }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const actualDefault = (actual as unknown as { default: typeof import('os') }).default
  return { ...actual, default: { ...actualDefault, homedir: () => MOCK_HOME }, homedir: () => MOCK_HOME }
})

vi.mock('../../core/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/constants')>()
  const p = require('path')
  const user = (u?: string) => p.join(MOCK_HOME, '.dawlab', 'users', u || actual.getUsername())
  return {
    ...actual,
    HOME: MOCK_HOME,
    VCS_DIR: p.join(MOCK_HOME, '.dawlab'),
    CAS_DIR: p.join(MOCK_HOME, '.dawlab', 'cas'),
    getUserDir: user,
    getRegistryFile: (u?: string) => p.join(user(u), 'registry.json'),
    getCommitsDir: (u?: string) => p.join(user(u), 'commits'),
    getLogsDir: (u?: string) => p.join(user(u), 'logs'),
  }
})
vi.mock('../../../workers/metadataManager', () => ({ extractMetadataInBackground: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => MOCK_HOME }, shell: { trashItem: vi.fn() } }))

import { setUsername } from '../../core/constants'
import { initProject } from '../init'
import { commitProject, captureDraft } from '../commit'
import { createBranch, switchBranch } from '../branch'
import { loadLocalProjectLog } from '../../core/log'
import { getWorkingChanges, discardWorkingChanges } from '../discard'

afterAll(() => fs.rmSync(MOCK_HOME, { recursive: true, force: true }))

const trashDir = path.join(MOCK_HOME, 'Trash')
/** A fake Trash: moves the item into a folder, like macOS does. */
const trash = vi.fn(async (full: string) => {
  fs.mkdirSync(trashDir, { recursive: true })
  fs.renameSync(full, path.join(trashDir, path.basename(full)))
})
const failingTrash = vi.fn(async () => { throw new Error('Trash is not available') })

let n = 0
let name = ''
let dir = ''
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}
const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8')
const exists = (rel: string) => fs.existsSync(path.join(dir, rel))
/** Every file in the folder (noise included), sorted. */
function tree(root = dir): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.name === '.dawlabproject') continue
      if (e.isDirectory()) walk(full)
      else out[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8')
    }
  }
  walk(root)
  return out
}

beforeEach(async () => {
  setUsername('max')
  trash.mockClear()
  fs.rmSync(trashDir, { recursive: true, force: true })
  name = `song${++n}`
  dir = path.join(MOCK_HOME, 'Music', name)
  // A Logic bundle: nested paths inside the .logicx package, plus audio next to it.
  write(`${name}.logicx/Alternatives/000/ProjectData`, 'project v1')
  write(`${name}.logicx/Alternatives/000/MetaData.plist`, 'meta v1')
  write('Audio Files/kick.wav', 'kick')
  write('Audio Files/snare.wav', 'snare')
  await initProject(name, dir, { storageMode: 'project', author: 'max' })
})

const changes = async () => (await getWorkingChanges(name)).changes.map((c) => `${c.kind[0].toUpperCase()} ${c.path}`)
const base = async () => (await getWorkingChanges(name)).baseCommitId!

describe('what Discard would undo', () => {
  it('is nothing right after saving', async () => {
    expect(await changes()).toEqual([])
  })

  it('lists added, changed and deleted files, inside bundles too', async () => {
    write(`${name}.logicx/Alternatives/000/ProjectData`, 'project v2 — longer')
    write('Audio Files/vox.wav', 'vox')
    fs.rmSync(path.join(dir, 'Audio Files/snare.wav'))
    expect(await changes()).toEqual([
      'A Audio Files/vox.wav',
      'D Audio Files/snare.wav',
      `M ${name}.logicx/Alternatives/000/ProjectData`,
    ].sort((a, b) => a.slice(2).localeCompare(b.slice(2))))
  })

  it('sees a change that keeps the file size', async () => {
    write('Audio Files/kick.wav', 'KICK')
    expect(await changes()).toEqual(['M Audio Files/kick.wav'])
  })

  it('ignores undo data, autosaves and Finder files', async () => {
    write(`${name}.logicx/Alternatives/000/Undo Data.nosync/1.undo`, 'undo')
    write(`${name}.logicx/Alternatives/000/Autosave/x`, 'auto')
    write('.DS_Store', 'finder')
    write('Audio Files/._kick.wav', 'apple double')
    expect(await changes()).toEqual([])
  })

  it('compares with the version you restored, on the alternative you are on', async () => {
    write('Audio Files/kick.wav', 'kick v2')
    await commitProject(name, 'v2', 'main', 'max')
    await createBranch(name, 'louder', undefined, 'max')
    await switchBranch(name, 'louder')
    write('Audio Files/kick.wav', 'kick louder')
    await commitProject(name, 'louder', 'louder', 'max')
    expect(await changes()).toEqual([])
    write('Audio Files/kick.wav', 'kick v1-ish')
    expect(await changes()).toEqual(['M Audio Files/kick.wav'])
  })

  it('has nothing to go back to on an alternative with no versions', async () => {
    await createBranch(name, 'empty', undefined, 'max')
    const logs = path.join(MOCK_HOME, '.dawlab', 'users', 'max', 'logs')
    const file = path.join(logs, fs.readdirSync(logs).find((f) => f.endsWith(`-${name}.json`))!)
    const l = JSON.parse(fs.readFileSync(file, 'utf8'))
    l.branches.find((b: any) => b.name === 'empty').commits = []
    fs.writeFileSync(file, JSON.stringify({ ...l, current_branch: 'empty', lastCheckout: null }))
    expect(await getWorkingChanges(name)).toEqual({ baseCommitId: null, changes: [], quiet: [] })
  })
})

describe('Discard', () => {
  it('puts the folder back exactly as saved and moves what it replaced to the Trash', async () => {
    const saved = tree()
    write(`${name}.logicx/Alternatives/000/ProjectData`, 'project v2')
    write('Audio Files/new take/vox.wav', 'vox')
    fs.rmSync(path.join(dir, 'Audio Files/snare.wav'))

    const result = await discardWorkingChanges(name, await base(), trash)
    expect(tree()).toEqual(saved)
    expect(exists('Audio Files/new take')).toBe(false)
    expect(result).toMatchObject({ restored: 2, removed: 1 })
    expect(await changes()).toEqual([])

    // One folder in the Trash, named after the project, holding the replaced files at their paths.
    expect(trash).toHaveBeenCalledTimes(1)
    expect(result.trashedAs).toMatch(new RegExp(`^${name} — discarded changes \\d{4}-\\d\\d-\\d\\d`))
    expect(tree(path.join(trashDir, result.trashedAs!))).toEqual({
      'Audio Files/new take/vox.wav': 'vox',
      [`${name}.logicx/Alternatives/000/ProjectData`]: 'project v2',
    })
    // Nothing is left next to the project.
    expect(fs.readdirSync(path.dirname(dir)).filter((f) => f.includes('discarded'))).toEqual([])
  })

  it('brings back deleted files without using the Trash', async () => {
    fs.rmSync(path.join(dir, 'Audio Files'), { recursive: true })
    const result = await discardWorkingChanges(name, await base(), trash)
    expect(read('Audio Files/kick.wav')).toBe('kick')
    expect(read('Audio Files/snare.wav')).toBe('snare')
    expect(trash).not.toHaveBeenCalled()
    expect(result.trashedAs).toBeNull()
  })

  it('leaves noise files alone', async () => {
    write(`${name}.logicx/Alternatives/000/Undo Data.nosync/1.undo`, 'undo')
    write('Audio Files/kick.wav', 'changed')
    await discardWorkingChanges(name, await base(), trash)
    expect(read(`${name}.logicx/Alternatives/000/Undo Data.nosync/1.undo`)).toBe('undo')
    expect(read('Audio Files/kick.wav')).toBe('kick')
  })

  it('changes nothing when the Trash fails', async () => {
    write(`${name}.logicx/Alternatives/000/ProjectData`, 'project v2')
    write('Audio Files/vox.wav', 'vox')
    fs.rmSync(path.join(dir, 'Audio Files/snare.wav'))
    const before = tree()
    const id = await base()
    await expect(discardWorkingChanges(name, id, failingTrash)).rejects.toThrow(/Couldn't move your current files to the Trash, so nothing was changed/)
    expect(tree()).toEqual(before)
    expect(fs.readdirSync(path.dirname(dir)).filter((f) => f.includes('discarded'))).toEqual([])
    expect(await changes()).toHaveLength(3)
  })

  it('refuses when the saved version changed after you looked', async () => {
    write('Audio Files/kick.wav', 'kick v2')
    const old = await base()
    await commitProject(name, 'v2', 'main', 'max')
    write('Audio Files/kick.wav', 'kick v3')
    await expect(discardWorkingChanges(name, old, trash)).rejects.toThrow(/changed in the meantime/)
    expect(read('Audio Files/kick.wav')).toBe('kick v3')
  })

  it('refuses, changing nothing, when a saved copy is missing from storage', async () => {
    write('Audio Files/kick.wav', 'kick v2')
    const cas = path.join(dir, '.dawlabproject', 'cas')
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
    const crypto = require('crypto')
    const kickHash = crypto.createHash('sha256').update('kick').digest('hex')
    for (const f of walk(cas)) if (path.basename(f) === kickHash) fs.rmSync(f)
    await expect(discardWorkingChanges(name, await base(), trash)).rejects.toThrow(/saved copy of Audio Files\/kick.wav is missing/)
    expect(read('Audio Files/kick.wav')).toBe('kick v2')
    expect(trash).not.toHaveBeenCalled()
  })

  it('forgets the unsaved snapshot, so there is nothing left to discard', async () => {
    write('Audio Files/kick.wav', 'kick v2')
    await captureDraft(name, 'main', 'max')
    expect(loadLocalProjectLog(name).draft).toBeTruthy()
    await discardWorkingChanges(name, await base(), trash)
    expect(loadLocalProjectLog(name).draft).toBeFalsy()
  })

  it('works for Ableton sets', async () => {
    const als = `${name}-live`
    dir = path.join(MOCK_HOME, 'Music', als)
    write(`${als}.als`, 'set v1')
    write('Samples/Recorded/take 1.wav', 'take')
    await initProject(als, dir, { storageMode: 'project', author: 'max' })
    name = als
    write(`${als}.als`, 'set v2')
    write('Samples/Recorded/take 2.wav', 'take 2')
    write('Backup/old.als', 'backup')
    expect(await changes()).toEqual([`M ${als}.als`, 'A Samples/Recorded/take 2.wav'].sort((a, b) => a.slice(2).localeCompare(b.slice(2))))
    await discardWorkingChanges(name, await base(), trash)
    expect(read(`${als}.als`)).toBe('set v1')
    expect(exists('Samples/Recorded/take 2.wav')).toBe(false)
    expect(read('Samples/Recorded/take 1.wav')).toBe('take')
    expect(read('Backup/old.als')).toBe('backup')
  })
})

describe('is the DAW open?', async () => {
  const { dawAppIn } = await import('../../core/daw-running')
  const ps = ['/sbin/launchd', '/Applications/Logic Pro.app/Contents/MacOS/Logic Pro', '/Applications/Ableton Live 12 Suite.app/Contents/MacOS/Live']

  it('names the app for the project\'s DAW only', () => {
    expect(dawAppIn(ps, 'Logic Pro X')).toBe('Logic Pro')
    expect(dawAppIn(ps, 'Ableton Live')).toBe('Ableton Live')
    expect(dawAppIn(['/sbin/launchd'], 'Logic Pro X')).toBeNull()
    expect(dawAppIn(['/Applications/Logic Pro Helper/x'], 'Logic Pro X')).toBeNull()
  })
})

describe('what isn’t a change', () => {
  const quiet = async () => (await getWorkingChanges(name)).quiet.map((c) => `${c.quiet} ${c.path}`)
  /** A tiny mono 16-bit WAV, with an optional extra chunk before the samples (what Logic adds on open). */
  const wav = (samples: number[], extra = '') => {
    const data = Buffer.alloc(samples.length * 2)
    samples.forEach((s, i) => data.writeInt16LE(s, i * 2))
    const fmt = Buffer.alloc(16)
    fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(48000, 4); fmt.writeUInt32LE(96000, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14)
    const chunk = (id: string, body: Buffer) => { const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]) }
    const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), ...(extra ? [chunk('LGWV', Buffer.from(extra.padEnd(8)))] : []), chunk('data', data)])
    return Buffer.concat([Buffer.from('RIFF'), Buffer.from(Uint32Array.of(body.length).buffer), body])
  }

  it('Logic’s window layout and screenshot are listed apart, not as changes', async () => {
    write(`${name}.logicx/Alternatives/000/DisplayState.plist`, 'windows moved')
    write(`${name}.logicx/Alternatives/000/WindowImage.jpg`, 'new screenshot')
    expect(await changes()).toEqual([])
    expect(await quiet()).toEqual([
      `layout ${name}.logicx/Alternatives/000/DisplayState.plist`,
      `layout ${name}.logicx/Alternatives/000/WindowImage.jpg`,
    ])
  })

  it('audio whose header was rewritten but sounds the same is not a change; new samples are', async () => {
    fs.writeFileSync(path.join(dir, 'Audio Files/bass.wav'), wav([1, 2, 3, 4]))
    await commitProject(name, 'bass', 'main', 'max')
    fs.writeFileSync(path.join(dir, 'Audio Files/bass.wav'), wav([1, 2, 3, 4], 'overview'))
    expect(await changes()).toEqual([])
    expect(await quiet()).toEqual(['audio-header Audio Files/bass.wav'])
    fs.writeFileSync(path.join(dir, 'Audio Files/bass.wav'), wav([1, 2, 3, 5], 'overview'))
    expect(await changes()).toEqual(['M Audio Files/bass.wav'])
  })
})

describe('Discard while the project is open in the DAW', () => {
  afterAll(async () => (await import('../guard')).setDawOpenCheck(null))

  it('refuses and changes nothing when the DAW holds the project’s files', async () => {
    const { setDawOpenCheck } = await import('../guard')
    write('Audio Files/kick.wav', 'kick v2')
    const id = await base()
    setDawOpenCheck(async () => ({ app: 'Logic Pro', holdsFiles: true }))
    await expect(discardWorkingChanges(name, id, trash)).rejects.toMatchObject({ code: 'DAW_OPEN' })
    expect(read('Audio Files/kick.wav')).toBe('kick v2')
    setDawOpenCheck(async () => ({ app: 'Logic Pro', holdsFiles: false }))
    await discardWorkingChanges(name, id, trash)
    expect(read('Audio Files/kick.wav')).toBe('kick')
  })
})
