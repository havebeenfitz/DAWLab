// @vitest-environment node
/**
 * Invariant: no switch loses work. For every operation that rewrites the
 * project folder, unsaved work (changed, new and deleted files, inside a Logic
 * bundle too) can be brought back byte for byte afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'

const { MOCK_HOME } = vi.hoisted(() => {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  return { MOCK_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-guard-')) as string }
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
// A Trash that behaves like macOS: the item is moved into it.
vi.mock('electron', () => ({
  app: { getPath: () => MOCK_HOME },
  shell: {
    trashItem: async (p: string) => {
      const fs = require('fs'); const path = require('path')
      const trash = path.join(MOCK_HOME, '.Trash')
      fs.mkdirSync(trash, { recursive: true })
      let to = path.join(trash, path.basename(p))
      for (let i = 2; fs.existsSync(to); i++) to = path.join(trash, `${path.basename(p)} ${i}`)
      fs.renameSync(p, to)
    },
  },
}))

import { setUsername } from '../../core/constants'
import { initProject } from '../init'
import { commitProject } from '../commit'
import { createBranch, switchBranch } from '../branch'
import { rollbackProject } from '../rollback'
import { makeParallelVersionMain } from '../parallel'
import { discardWorkingChanges, getWorkingChanges } from '../discard'
import { AUTO_SNAPSHOT_PREFIX } from '../guard'
import { loadLocalProjectLog, saveProjectLog } from '../../core/log'
import { checkOutLatest } from '../../../sync/hub-client'
import { privateSnapshotIds, toSharedLog } from '../../../../shared/hub-protocol'

afterAll(() => fs.rmSync(MOCK_HOME, { recursive: true, force: true }))

let n = 0
let name = ''
let dir = ''
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}
const noise = (rel: string) => rel.includes('.dawlabproject') || rel.endsWith('.DS_Store')
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (noise(rel)) continue
      if (e.isDirectory()) walk(full)
      else out[rel] = fs.readFileSync(full).toString('base64')
    }
  }
  if (fs.existsSync(root)) walk(root)
  return out
}
const allCommits = () => (loadLocalProjectLog(name).branches as any[]).flatMap((b) => b.commits.map((c: any) => ({ ...c, branch: b.name })))
const snapshots = () => allCommits().filter((c) => c.auto)
const byMessage = (m: string) => String(allCommits().find((c) => c.message === m)!.commit_id)

/** A Logic project with v1 and v2 on main, an alternative "drums", and a parallel version from bob. */
async function setUp() {
  setUsername('max')
  name = `song${++n}`
  dir = path.join(MOCK_HOME, 'Music', name)
  write(`${name}.logicx/Alternatives/000/ProjectData`, 'v1 project')
  write('Audio Files/kick.wav', 'kick')
  write('Audio Files/snare.wav', 'snare')
  await initProject(name, dir, { storageMode: 'project', author: 'max' })
  write(`${name}.logicx/Alternatives/000/ProjectData`, 'v2 project, longer')
  await commitProject(name, 'v2', 'main', 'max')
  const v2 = byMessage('v2')
  await createBranch(name, 'drums', v2, 'max')
  await switchBranch(name, 'drums')
  write('Audio Files/kick.wav', 'drums kick')
  await commitProject(name, 'drums take', 'drums', 'max')
  await switchBranch(name, 'main')
  await rollbackProject(name, v2)
  // A parallel version from bob, split from v2.
  const log = loadLocalProjectLog(name)
  const drums = log.branches.find((b: any) => b.name === 'drums')
  log.branches.push({ name: 'bob · 1 Feb', forkOf: { branch: 'main', parent: v2, author: 'bob' }, commits: drums.commits.map((c: any) => ({ ...c, author: 'bob', parent: v2 })) })
  log.branches = log.branches.filter((b: any) => b.name !== 'drums').concat([{ ...drums, commits: [] }])
  saveProjectLog(name, log)
  await rollbackProject(name, v2)
}

/** Unsaved work: a changed file inside the bundle, a new take in a new folder, a deleted sample. */
function makeUnsavedWork() {
  write(`${name}.logicx/Alternatives/000/ProjectData`, 'my unsaved arrangement')
  write('Audio Files/takes/vox 1.wav', 'vox')
  fs.rmSync(path.join(dir, 'Audio Files/snare.wav'))
  write('.DS_Store', 'finder')
}

async function expectRecoverable(before: Record<string, string>, target: string) {
  const snaps = snapshots()
  expect(snaps).toHaveLength(1)
  expect(snaps[0].message).toBe(`${AUTO_SNAPSHOT_PREFIX} ${target}`)
  const out = path.join(MOCK_HOME, 'recovered', `${name}-${Math.random().toString(36).slice(2)}`)
  await rollbackProject(name, String(snaps[0].commit_id), out)
  expect(tree(out)).toEqual(before)
}

const SWITCHES: Array<{ name: string; target: string; run: () => Promise<unknown> }> = [
  { name: 'Restore an older version', target: '“Initial Commit”', run: () => rollbackProject(name, byMessage('Initial Commit')) },
  { name: 'Restore the same version again', target: '“v2”', run: () => rollbackProject(name, byMessage('v2')) },
  { name: 'Restore a version on another alternative', target: '“drums take” on bob · 1 Feb', run: () => rollbackProject(name, String(allCommits().filter((c) => c.branch === 'bob · 1 Feb').at(-1)!.commit_id)) },
  { name: 'Make a parallel version main', target: 'bob’s version', run: () => makeParallelVersionMain(name, 'bob · 1 Feb', 'max') },
  { name: 'Lay out the newest version after a sync', target: '“v2”', run: () => checkOutLatest(name, dir, 'edit') },
  { name: 'Discard changes', target: 'the last saved version', run: async () => discardWorkingChanges(name, (await getWorkingChanges(name)).baseCommitId!, async (p) => { fs.renameSync(p, path.join(MOCK_HOME, path.basename(p))) }) },
]

describe('no switch loses work', () => {
  beforeEach(setUp)

  for (const op of SWITCHES) {
    it(`${op.name}: unsaved work is kept as a version first, byte for byte`, async () => {
      makeUnsavedWork()
      const before = tree(dir)
      await op.run()
      await expectRecoverable(before, op.target)
    })
  }

  it('saves nothing extra when there is no unsaved work', async () => {
    for (const op of SWITCHES.slice(0, 5)) {
      await op.run()
      expect(snapshots()).toEqual([])
    }
  })

  it('refuses the switch, changing nothing, when the snapshot can\'t be stored', async () => {
    makeUnsavedWork()
    const before = tree(dir)
    const cas = path.join(dir, '.dawlabproject', 'cas')
    const lock = (mode: number) => {
      const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name)); fs.chmodSync(d, mode) }
      walk(cas)
    }
    lock(0o555)
    try {
      await expect(rollbackProject(name, byMessage('Initial Commit'))).rejects.toThrow(/Couldn't save your unsaved work first, so nothing was switched/)
    } finally {
      lock(0o755)
    }
    expect(tree(dir)).toEqual(before)
    expect(snapshots()).toEqual([])
  })

  it('keeps the snapshot on the alternative you were on, marked auto, and you can bring it back', async () => {
    makeUnsavedWork()
    const before = tree(dir)
    await rollbackProject(name, byMessage('Initial Commit'))
    const snap = snapshots()[0]
    expect(snap.branch).toBe('main')
    expect(snap.parent).toBe(byMessage('v2'))
    await rollbackProject(name, String(snap.commit_id)) // "Bring back"
    expect(tree(dir)).toEqual(before)
  })
})

describe('Restore is an exact copy of the version', () => {
  beforeEach(setUp)

  it('moves files the version doesn\'t have to the Trash, inside .logicx too, and Bring back returns them byte for byte', async () => {
    write(`${name}.logicx/Alternatives/001/ProjectData`, 'a second Logic alternative')
    write(`${name}.logicx/Resources/extra.plist`, 'extra')
    write('Audio Files/takes/vox 1.wav', 'vox')
    write(`${name}.logicx/Alternatives/000/Undo Data.nosync/1.undo`, 'undo')
    const before = tree(dir)

    const r = await rollbackProject(name, byMessage('Initial Commit'))
    const initial = path.join(MOCK_HOME, 'initial', name)
    await rollbackProject(name, byMessage('Initial Commit'), initial)
    // The folder is exactly the version now (noise left alone).
    const now = tree(dir)
    expect(Object.keys(now).filter((k) => !k.includes('.nosync')).sort()).toEqual(Object.keys(tree(initial)).sort())
    expect(now[`${name}.logicx/Alternatives/000/Undo Data.nosync/1.undo`]).toBe(Buffer.from('undo').toString('base64'))
    expect(r.removed).toBe(3)
    expect(r.keptAs?.message).toBe(`${AUTO_SNAPSHOT_PREFIX} “Initial Commit”`)
    // The removed files are in the Trash, in one folder, at their paths.
    expect(Object.keys(tree(path.join(MOCK_HOME, '.Trash', r.trashedAs!))).sort()).toEqual([
      'Audio Files/takes/vox 1.wav', `${name}.logicx/Alternatives/001/ProjectData`, `${name}.logicx/Resources/extra.plist`,
    ].sort())
    expect(fs.existsSync(path.join(dir, 'Audio Files/takes'))).toBe(false)

    await rollbackProject(name, r.keptAs!.commitId) // Bring back
    expect(tree(dir)).toEqual(before)
  })

  it('changes nothing when the Trash fails', async () => {
    write('Audio Files/takes/vox 1.wav', 'vox')
    const before = tree(dir)
    await expect(rollbackProject(name, byMessage('Initial Commit'), undefined, { trash: async () => { throw new Error('no Trash') } }))
      .rejects.toThrow(/Couldn't move files to the Trash, so nothing was changed/)
    expect(tree(dir)).toEqual(before)
  })

  it('leaves a preview folder alone: only the project folder is made exact', async () => {
    const out = path.join(MOCK_HOME, 'preview', name)
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'keep.txt'), 'mine')
    const r = await rollbackProject(name, byMessage('Initial Commit'), out)
    expect(fs.readFileSync(path.join(out, 'keep.txt'), 'utf8')).toBe('mine')
    expect(r).toMatchObject({ removed: 0, keptAs: null })
  })
})

describe('snapshots stay on this Mac until you build on them', () => {
  beforeEach(setUp)

  it('is left out of what is shared, then shared once you save on top of it', async () => {
    makeUnsavedWork()
    await rollbackProject(name, byMessage('Initial Commit'))
    const snap = String(snapshots()[0].commit_id)
    const shared = () => toSharedLog(loadLocalProjectLog(name)).branches.flatMap((b) => b.commits.map((c) => c.commit_id))
    expect(privateSnapshotIds(loadLocalProjectLog(name))).toEqual(new Set([snap]))
    expect(shared()).not.toContain(snap)

    await rollbackProject(name, snap)
    write('Audio Files/takes/vox 2.wav', 'vox 2')
    await commitProject(name, 'built on it', 'main', 'max')
    expect(privateSnapshotIds(loadLocalProjectLog(name)).has(snap)).toBe(false)
    expect(shared()).toContain(snap)
  })
})
