// @vitest-environment node
/** Previewing a parallel version: its own folder next to yours, yours never touched, then to the Trash. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'

const { MOCK_HOME } = vi.hoisted(() => {
  const os = require('os'); const path = require('path'); const fs = require('fs')
  return { MOCK_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-pv-')) as string }
})
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>()
  const d = (actual as any).default
  return { ...actual, default: { ...d, homedir: () => MOCK_HOME }, homedir: () => MOCK_HOME }
})
vi.mock('../../core/constants', async (orig) => {
  const actual = await orig<typeof import('../../core/constants')>()
  const p = require('path')
  const user = (u?: string) => p.join(MOCK_HOME, '.dawlab', 'users', u || actual.getUsername())
  return { ...actual, HOME: MOCK_HOME, VCS_DIR: p.join(MOCK_HOME, '.dawlab'), CAS_DIR: p.join(MOCK_HOME, '.dawlab', 'cas'), getUserDir: user,
    getRegistryFile: (u?: string) => p.join(user(u), 'registry.json'), getCommitsDir: (u?: string) => p.join(user(u), 'commits'), getLogsDir: (u?: string) => p.join(user(u), 'logs') }
})
vi.mock('../../../workers/metadataManager', () => ({ extractMetadataInBackground: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => MOCK_HOME }, shell: { trashItem: vi.fn() } }))

import { setUsername } from '../../core/constants'
import { initProject } from '../init'
import { commitProject } from '../commit'
import { loadLocalProjectLog, saveProjectLog } from '../../core/log'
import { startParallelPreview, endParallelPreview, getParallelPreview } from '../parallel-preview'

const trashDir = path.join(MOCK_HOME, '.Trash')
const trash = vi.fn(async (p: string) => {
  fs.mkdirSync(trashDir, { recursive: true })
  let to = path.join(trashDir, path.basename(p))
  for (let i = 2; fs.existsSync(to); i++) to = `${to} ${i}`
  fs.renameSync(p, to)
})
const dir = path.join(MOCK_HOME, 'Music', 'Song')
const read = (p: string) => fs.readFileSync(p, 'utf8')

beforeAll(async () => {
  setUsername('max')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'Song.als'), 'mine v1')
  await initProject('Song', dir, { storageMode: 'project', author: 'max' })
  fs.writeFileSync(path.join(dir, 'Song.als'), 'bob drums')
  fs.writeFileSync(path.join(dir, 'drums.wav'), 'drums')
  const { commitId } = await commitProject('Song', 'bob drums', 'main', 'bob')
  // Move bob's version into a parallel alternative, as a sync would.
  const log = loadLocalProjectLog('Song')
  const main = log.branches.find((b: any) => b.name === 'main')
  const bob = main.commits.find((c: any) => c.commit_id === commitId)
  main.commits = main.commits.filter((c: any) => c !== bob)
  log.branches.push({ name: 'bob · 25 Nov', forkOf: { branch: 'main', parent: main.commits[0].commit_id, author: 'bob' }, commits: [bob] })
  saveProjectLog('Song', { ...log, lastCheckout: { commitId: main.commits[0].commit_id, timestamp: 'x' } })
  // My unsaved work in the folder.
  fs.writeFileSync(path.join(dir, 'Song.als'), 'my unsaved work')
  fs.rmSync(path.join(dir, 'drums.wav'))
})
afterAll(() => fs.rmSync(MOCK_HOME, { recursive: true, force: true }))

describe('previewing a parallel version', () => {
  it('lays it out next to the project and never touches your folder', async () => {
    const p = await startParallelPreview('Song', 'bob · 25 Nov', trash)
    expect(p.path).toBe(path.join(MOCK_HOME, 'Music', 'Song (preview · bob)'))
    expect(read(path.join(p.path, 'Song.als'))).toBe('bob drums')
    expect(read(path.join(p.path, 'drums.wav'))).toBe('drums')
    expect(read(path.join(dir, 'Song.als'))).toBe('my unsaved work')
    expect(fs.existsSync(path.join(dir, 'drums.wav'))).toBe(false)
    expect(loadLocalProjectLog('Song').branches.flatMap((b: any) => b.commits).filter((c: any) => c.auto)).toEqual([])
    // Your checked-out version stays yours.
    expect(loadLocalProjectLog('Song').lastCheckout.commitId).not.toBe(p.commitId)
    expect(getParallelPreview('Song')).toMatchObject({ branch: 'bob · 25 Nov', author: 'bob', message: 'bob drums' })
  })

  it('replaces an open preview instead of piling up folders', async () => {
    const again = await startParallelPreview('Song', 'bob · 25 Nov', trash)
    expect(again.path).toBe(path.join(MOCK_HOME, 'Music', 'Song (preview · bob)'))
    expect(trash).toHaveBeenCalledTimes(1)
  })

  it('Back to mine moves the preview folder to the Trash and forgets it', async () => {
    await endParallelPreview('Song', trash)
    expect(fs.existsSync(path.join(MOCK_HOME, 'Music', 'Song (preview · bob)'))).toBe(false)
    expect(getParallelPreview('Song')).toBeNull()
    expect(read(path.join(dir, 'Song.als'))).toBe('my unsaved work')
    await endParallelPreview('Song', trash) // nothing open: fine
  })

  it('explains an alternative that is gone', async () => {
    await expect(startParallelPreview('Song', 'nope', trash)).rejects.toThrow(/no longer exists/)
  })
})
