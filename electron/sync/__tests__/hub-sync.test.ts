// @vitest-environment node
/**
 * End-to-end: two local users share one project through a real in-process
 * DAWLab Hub (filesystem storage), the way two producers would.
 *
 * Set HUB_LIVE_URL (and HUB_LIVE_KEY, unless something in front of the hub
 * adds the X-Hub-Key header) to run the same flow against a deployed hub.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import http from 'http'
import type { AddressInfo } from 'net'

const { MOCK_HOME } = vi.hoisted(() => {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  const dir = path.join(os.tmpdir(), `dawlab-hub-test-${process.pid}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return { MOCK_HOME: dir }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const actualDefault = (actual as unknown as { default: typeof import('os') }).default
  return { ...actual, default: { ...actualDefault, homedir: () => MOCK_HOME }, homedir: () => MOCK_HOME }
})

vi.mock('../../dawvcs/core/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dawvcs/core/constants')>()
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

vi.mock('../../workers/metadataManager', () => ({ extractMetadataInBackground: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => MOCK_HOME } }))

import { setUsername } from '../../dawvcs/core/constants'
import { initProject } from '../../dawvcs/operations/init'
import { commitProject, addPreviewToCommit } from '../../dawvcs/operations/commit'
import { loadLocalProjectLog } from '../../dawvcs/core/log'
import { getProjectStorageDirs } from '../../dawvcs/core/storage-location'
import { getCommitPath, getCommitFileMap } from '../../dawvcs/core/commits'
import { getCasPath } from '../../dawvcs/core/cas'
import { getProjectPath } from '../../dawvcs/core/registry'
import { saveHubSettings, shareProject, syncProject, openSharedProject, getProjectRemote } from '../hub-client'
import { createHub } from '../../../server/src/app.ts'
import { FsStorage } from '../../../server/src/storage.ts'

const commitIds = (projectName: string) =>
  loadLocalProjectLog(projectName).branches.flatMap((b: any) => b.commits.map((c: any) => c.commit_id))

describe('DAWLab Hub sharing', () => {
  let server: http.Server
  let hubUrl: string
  const work = path.join(MOCK_HOME, 'work')
  const aliceDir = path.join(work, 'alice', 'Song')
  const bobParent = path.join(work, 'bob')
  const name = 'Song'
  let editUrl = ''
  let listenUrl = ''

  const live = process.env.HUB_LIVE_URL
  const hubKey = live ? process.env.HUB_LIVE_KEY ?? '' : 'secret-key'

  beforeAll(async () => {
    if (live) {
      hubUrl = live.replace(/\/+$/, '')
    } else {
      server = http.createServer(createHub({ storage: new FsStorage(path.join(MOCK_HOME, 'hub-data')), createKey: 'secret-key' }))
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
      hubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    }

    fs.mkdirSync(path.join(aliceDir, 'Samples'), { recursive: true })
    fs.writeFileSync(path.join(aliceDir, 'Song.als'), 'ableton v1')
    fs.writeFileSync(path.join(aliceDir, 'Samples', 'kick.wav'), 'RIFF....WAVEkick')
    fs.mkdirSync(bobParent, { recursive: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
    server?.close()
    fs.rmSync(MOCK_HOME, { recursive: true, force: true })
  })

  it('refuses to create a project without the hub key', async () => {
    setUsername('alice')
    await initProject(name, aliceDir, { storageMode: 'project', author: 'alice' })
    if (live && !process.env.HUB_LIVE_KEY) return // a proxy adds the real key to every request
    saveHubSettings({ hubUrl, hubKey: 'wrong' })
    await expect(shareProject(name)).rejects.toThrow(/did not accept this key/)
  })

  it('shares a project and its comments', async () => {
    setUsername('alice')
    saveHubSettings({ hubUrl, hubKey })
    const result = await shareProject(name)
    expect(result.pushed).toBe(1)
    expect(result.uploadedFiles).toBe(2)
    editUrl = result.remote.editUrl
    listenUrl = result.remote.listenUrl!
    expect(editUrl).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/)

    const [first] = commitIds(name)
    const { commitsDir } = getProjectStorageDirs(name)
    fs.writeFileSync(path.join(getCommitPath(name, first, commitsDir), 'comments.json'), JSON.stringify({
      version: 1, comments: [{ id: 'c1', username: 'alice', comment: 'kick too loud', timestamp: 12 }],
    }))
    const again = await syncProject(name)
    expect(again.pushed).toBe(0)
    expect(again.uploadedFiles).toBe(0)
  })

  it('lets a collaborator open the project by link, with files and comments', async () => {
    setUsername('bob')
    const { projectName, projectPath } = await openSharedProject(editUrl, bobParent)
    expect(projectName).toBe(name)
    expect(fs.readFileSync(path.join(projectPath, 'Song.als'), 'utf8')).toBe('ableton v1')
    expect(fs.readFileSync(path.join(projectPath, 'Samples', 'kick.wav'), 'utf8')).toBe('RIFF....WAVEkick')

    const [first] = commitIds(name)
    const { commitsDir } = getProjectStorageDirs(name)
    const comments = JSON.parse(fs.readFileSync(path.join(getCommitPath(name, first, commitsDir), 'comments.json'), 'utf8'))
    expect(comments.comments[0].comment).toBe('kick too loud')
    expect(getProjectRemote(name)?.token).toBeTruthy()
  })

  it('syncs a new version from the collaborator back to the owner', async () => {
    setUsername('bob')
    vi.setSystemTime(new Date('2026-01-01T11:00:00Z'))
    fs.writeFileSync(path.join(getProjectPath(name)!, 'Song.als'), 'ableton v2 by bob')
    await commitProject(name, 'bob idea', 'main', 'bob')
    const bobSync = await syncProject(name)
    expect(bobSync.pushed).toBe(1)
    expect(bobSync.uploadedFiles).toBe(1) // only the changed file

    setUsername('alice')
    const aliceSync = await syncProject(name)
    expect(aliceSync.pulled).toBe(1)
    expect(aliceSync.downloadedFiles).toBe(1)
    const log = loadLocalProjectLog(name)
    expect(log.branches[0].commits.map((c: any) => c.message)).toEqual(['Initial Commit', 'bob idea'])
  })

  it('opens a listener link in the app with previews and comments only', async () => {
    setUsername('alice')
    const preview = path.join(work, 'mix.wav')
    fs.writeFileSync(preview, 'RIFF....WAVEmix')
    const [first] = commitIds(name)
    await addPreviewToCommit(name, first, preview)
    await syncProject(name)

    setUsername('carol')
    const carolParent = path.join(work, 'carol')
    fs.mkdirSync(carolParent, { recursive: true })
    const { projectName, projectPath } = await openSharedProject(listenUrl, carolParent)
    const log = loadLocalProjectLog(projectName)
    expect(log.branches[0].commits.map((c: any) => c.message)).toEqual(['Initial Commit', 'bob idea'])
    expect(fs.readdirSync(projectPath)).toEqual([]) // no project files for listeners
    const { casDir, commitsDir } = getProjectStorageDirs(projectName)
    expect(getCommitFileMap(projectName, first, commitsDir)).toEqual([])
    const previewHash = log.branches[0].commits[0].preview_file
    expect(fs.readFileSync(getCasPath(previewHash, casDir), 'utf8')).toBe('RIFF....WAVEmix')

    // A listener's comment reaches the owner.
    const file = path.join(getCommitPath(projectName, first, commitsDir), 'comments.json')
    const mine = JSON.parse(fs.readFileSync(file, 'utf8'))
    mine.comments.push({ id: 'w1', username: 'carol', comment: 'love it', timestamp: 3 })
    fs.writeFileSync(file, JSON.stringify(mine))
    expect((await syncProject(projectName)).pushed).toBe(0)

    setUsername('alice')
    await syncProject(name)
    const aliceDirs = getProjectStorageDirs(name)
    const aliceComments = JSON.parse(fs.readFileSync(path.join(getCommitPath(name, first, aliceDirs.commitsDir), 'comments.json'), 'utf8'))
    expect(aliceComments.comments.map((c: any) => c.id)).toEqual(['c1', 'w1'])

    // And the listener token can't read project files or change history.
    const token = listenUrl.split('/s/')[1]
    const auth = { 'X-Hub-Token': token }
    expect((await fetch(`${hubUrl}/api/project/commits/${first}/filemap`, { headers: auth })).status).toBe(403)
    expect((await fetch(`${hubUrl}/api/project/log`, { method: 'PUT', headers: auth, body: '{}' })).status).toBe(403)
  })

  it('shows nothing to anyone without a key or token', async () => {
    const probes: Array<[string, RequestInit?]> = [
      ['/'], ['/healthz'], ['/s/abcdefghijklmnopqrstuvwx'], ['/api/project'],
      ['/api/project', { headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwx' } }],
      ['/api/project', { headers: { 'X-Hub-Token': 'abcdefghijklmnopqrstuvwx' } }],
      ['/api/projects', { method: 'POST', body: '{}' }],
      ['/api/projects', { method: 'POST', headers: { 'X-Hub-Key': 'nope' }, body: '{}' }],
      ['/api/project/objects/' + 'a'.repeat(64), { method: 'PUT', body: 'x' }],
      ['/api/project/log', { method: 'DELETE' }],
      ...(live ? [] : [['/%E0%A4%A'] as [string]]), // proxies in front of a live hub reject it before it arrives
    ]
    for (const [p, init] of probes) {
      if (live && !process.env.HUB_LIVE_KEY && p === '/api/projects') continue // the proxy adds the real key
      const res = await fetch(hubUrl + p, init)
      expect(res.status, p).toBe(404)
      expect(await res.text(), p).toBe('')
    }
  })

  it('rejects uploads whose content does not match the hash', async () => {
    setUsername('alice')
    const token = getProjectRemote(name)!.token
    const res = await fetch(`${hubUrl}/api/project/objects/${'0'.repeat(64)}`, {
      method: 'PUT', headers: { 'X-Hub-Token': token }, body: 'not that',
    })
    expect(res.status).toBe(400)
  })
})
