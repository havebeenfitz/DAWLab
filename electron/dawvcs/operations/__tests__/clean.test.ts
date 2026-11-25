// @vitest-environment node
/** Clean Storage: finds and deletes only files no version needs, in every store. */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

const { MOCK_HOME } = vi.hoisted(() => {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  return { MOCK_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-clean-')) as string }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const actualDefault = (actual as unknown as { default: typeof import('os') }).default
  return { ...actual, default: { ...actualDefault, homedir: () => MOCK_HOME }, homedir: () => MOCK_HOME }
})

import { getCleanableFiles, cleanCasFiles } from '../clean'
import { getCasPath } from '../../core/cas'

afterAll(() => fs.rmSync(MOCK_HOME, { recursive: true, force: true }))

const homeCas = path.join(MOCK_HOME, '.dawlab', 'cas')
const userDir = path.join(MOCK_HOME, '.dawlab', 'users', 'max')
const songDir = path.join(MOCK_HOME, 'Music', 'Song')
const songCas = path.join(songDir, '.dawlabproject', 'cas')
const h = (c: string) => c.repeat(64)

function store(hash: string, casDir: string, bytes = 10) {
  const file = getCasPath(hash, casDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.alloc(bytes))
}

function commit(commitsDir: string, project: string, id: string, hashes: string[]) {
  const dir = path.join(commitsDir, project, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'filemap.json'), JSON.stringify(hashes.map((hash, i) => ({ path: `f${i}.wav`, hash }))))
}

beforeEach(() => {
  fs.rmSync(path.join(MOCK_HOME, '.dawlab'), { recursive: true, force: true })
  fs.rmSync(songDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(userDir, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(userDir, 'registry.json'), JSON.stringify({
    projects: { Song: { name: 'Song', path: songDir, storage_mode: 'project' }, Home: { name: 'Home', path: '/x', storage_mode: 'home' } },
  }))
  // Song keeps its versions next to itself: a used and a left-over file.
  commit(path.join(songDir, '.dawlabproject', 'commits'), 'Song', 'c1', [h('a'), 'empty'])
  store(h('a'), songCas)
  store(h('b'), songCas, 30)
  // The home store: a used file, a preview a log points at, and a leftover.
  commit(path.join(userDir, 'commits'), 'Home', 'c1', [h('d')])
  fs.writeFileSync(path.join(userDir, 'logs', 'id-Home.json'), JSON.stringify({ branches: [{ commits: [{ commit_id: 'c1', preview_file: h('e') }] }] }))
  store(h('d'), homeCas)
  store(h('e'), homeCas)
  store(h('c'), homeCas, 20)
})

describe('Clean Storage', () => {
  it('lists leftovers in the home store and in projects that keep versions next to themselves', () => {
    const files = getCleanableFiles().sort((x, y) => x.hash.localeCompare(y.hash))
    expect(files.map((f) => [f.hash[0], f.size])).toEqual([['b', 30], ['c', 20]])
  })

  it('never lists files a version or a preview still needs', () => {
    const hashes = getCleanableFiles().map((f) => f.hash)
    for (const used of [h('a'), h('d'), h('e')]) expect(hashes).not.toContain(used)
  })

  it('deletes only leftovers, even when asked for used files', () => {
    const stats = cleanCasFiles([h('a'), h('b'), h('c'), h('d'), h('e'), 'nope'])
    expect(stats).toEqual({ filesDeleted: 2, bytesFreed: 50, errors: [] })
    expect(fs.existsSync(getCasPath(h('a'), songCas))).toBe(true)
    expect(fs.existsSync(getCasPath(h('b'), songCas))).toBe(false)
    expect(fs.existsSync(getCasPath(h('c'), homeCas))).toBe(false)
    expect(fs.existsSync(getCasPath(h('d'), homeCas))).toBe(true)
    expect(fs.existsSync(getCasPath(h('e'), homeCas))).toBe(true)
    expect(getCleanableFiles()).toEqual([])
  })

  it('keeps a file another user on this Mac still needs', () => {
    commit(path.join(MOCK_HOME, '.dawlab', 'users', 'ann', 'commits'), 'Hers', 'c1', [h('c')])
    expect(getCleanableFiles().map((f) => f.hash)).toEqual([h('b')])
  })

  it('is empty when nothing has been stored yet', () => {
    fs.rmSync(path.join(MOCK_HOME, '.dawlab'), { recursive: true, force: true })
    fs.rmSync(songDir, { recursive: true, force: true })
    expect(getCleanableFiles()).toEqual([])
    expect(cleanCasFiles([h('b')])).toEqual({ filesDeleted: 0, bytesFreed: 0, errors: [] })
  })
})
