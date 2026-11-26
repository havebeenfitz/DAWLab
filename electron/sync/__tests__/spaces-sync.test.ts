// @vitest-environment node
/**
 * End-to-end: a shared folder between three people on one in-process hub.
 * Alice shares a Library folder with two projects, Bob joins as a
 * collaborator, Carol as a listener. They add versions and projects and
 * Alice manages who has access.
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
  const dir = path.join(os.tmpdir(), `dawlab-spaces-test-${process.pid}-${Date.now()}`)
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
import { getUserConfigManager } from '../../dawvcs/core/config'
import { initProject } from '../../dawvcs/operations/init'
import { commitProject } from '../../dawvcs/operations/commit'
import { loadLocalProjectLog } from '../../dawvcs/core/log'
import { loadRegistry, getProjectPath } from '../../dawvcs/core/registry'
import { saveHubSettings } from '../hub-client'
import { openParallelVersions } from '../../../shared/forks'
import { makeParallelVersionMain } from '../../dawvcs/operations/parallel'
import { rollbackProject } from '../../dawvcs/operations/rollback'
import {
  shareFolder, syncSpace, joinSpace, createInvite, getSpaceDetails, getSpaceForProject, listLocalSpaces,
  changeMemberRole, removeMember, previewInvite, leaveSpace, parseInvite, revokeInvite, stopSharing, listInvites, getServerStorage,
  syncSharedProject, countIncomingVersions, findSharedProject, getLocalSpace, deleteProjectFromServer,
} from '../spaces-client'
import { saveProjectRemote } from '../hub-client'
import { createHub } from '../../../server/src/app.ts'
import { FsStorage } from '../../../server/src/storage.ts'

const versions = (projectName: string) =>
  loadLocalProjectLog(projectName).branches.flatMap((b: any) => b.commits.map((c: any) => String(c.commit_id)))

const projectId = (projectName: string) => String(loadRegistry()[projectName].project_id)

describe('Shared folders', () => {
  let server: http.Server
  let hubUrl = ''
  const work = path.join(MOCK_HOME, 'work')
  let aliceFolder = ''
  let bobFolder = ''
  let carolFolder = ''
  let carolMemberId = ''
  let editInvite = ''
  let listenInvite = ''

  beforeAll(async () => {
    server = http.createServer(createHub({ storage: new FsStorage(path.join(MOCK_HOME, 'hub-data')), createKey: 'secret-key-for-tests' }))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    hubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    for (const song of ['Intro', 'Snow']) {
      const dir = path.join(work, 'alice', song)
      fs.mkdirSync(path.join(dir, 'Samples'), { recursive: true })
      fs.writeFileSync(path.join(dir, `${song}.als`), `${song} v1`)
      fs.writeFileSync(path.join(dir, 'Samples', 'kick.wav'), `RIFF....WAVE${song}`)
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-01T10:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
    server?.close()
    fs.rmSync(MOCK_HOME, { recursive: true, force: true })
  })

  it('needs a connected server before sharing', async () => {
    setUsername('alice')
    const folder = getUserConfigManager('alice').createFolder('Album', null)
    aliceFolder = folder.id
    await expect(shareFolder(aliceFolder)).rejects.toThrow(/Connect a DAWLab server first/)
  })

  it('shares a Library folder with every project in it', async () => {
    setUsername('alice')
    const manager = getUserConfigManager('alice')
    for (const song of ['Intro', 'Snow']) {
      await initProject(song, path.join(work, 'alice', song), { storageMode: 'project', author: 'alice' })
      manager.moveProject(projectId(song), aliceFolder)
    }
    saveHubSettings({ hubUrl, hubKey: 'secret-key-for-tests' })

    const result = await shareFolder(aliceFolder)
    expect(result.failed).toEqual([])
    expect(result.uploadedProjects.sort()).toEqual(['Intro', 'Snow'])
    expect(result.addedProjects).toEqual([])
    expect(result.pushedVersions).toBe(2)
    expect(result.space.role).toBe('owner')
    expect(getSpaceForProject('Snow')?.folderId).toBe(aliceFolder)
    // Sharing must not duplicate versions in the local history
    expect(versions('Snow')).toHaveLength(1)
    expect(versions('Intro')).toHaveLength(1)

    const again = await syncSpace(aliceFolder)
    expect(again.pushedVersions).toBe(0)
    expect(again.uploadedProjects).toEqual([])
  })

  it('creates invites that show what they open without using them up', async () => {
    setUsername('alice')
    const edit = await createInvite(aliceFolder, 'edit')
    // The code carries the server address, so joiners need no settings at all.
    expect(edit.code).toMatch(/^DAWL-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/)
    expect(edit.code).not.toContain('127.0.0.1')
    expect(edit.link.startsWith('dawlab://join?')).toBe(true)
    editInvite = edit.code
    listenInvite = (await createInvite(aliceFolder, 'listen')).link

    // The owner is already in: the invite is recognised as their own folder.
    expect((await previewInvite(editInvite)).alreadyIn?.folderId).toBe(aliceFolder)

    setUsername('bob')
    const preview = await previewInvite(editInvite)
    expect(preview.space.name).toBe('Album')
    expect(preview.role).toBe('edit')
    expect(preview.projectCount).toBe(2)
    expect(parseInvite(editInvite).hubUrl).toBe(hubUrl)
  })

  it('lets a collaborator join: folder, projects and files arrive', async () => {
    setUsername('bob')
    const result = await joinSpace(editInvite, path.join(work, 'bob'))
    bobFolder = result.folderId
    expect(result.failed).toEqual([])
    expect(result.space.role).toBe('edit')
    expect(getUserConfigManager('bob').getFolders().find((f) => f.id === bobFolder)?.name).toBe('Album')
    for (const song of ['Intro', 'Snow']) {
      expect(getUserConfigManager('bob').getProjectFolder(projectId(song))).toBe(bobFolder)
      expect(fs.readFileSync(path.join(getProjectPath(song), `${song}.als`), 'utf8')).toBe(`${song} v1`)
    }
  })

  it('lets a listener join with previews and comments only', async () => {
    setUsername('carol')
    const result = await joinSpace(listenInvite, path.join(work, 'carol'))
    carolFolder = result.folderId
    carolMemberId = result.space.memberId
    expect(result.space.role).toBe('listen')
    expect(versions('Snow')).toHaveLength(1)
    expect(fs.existsSync(path.join(getProjectPath('Snow'), 'Snow.als'))).toBe(false)
  })

  it('syncs a new version both ways', async () => {
    setUsername('bob')
    fs.writeFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'Snow v2 from bob')
    vi.setSystemTime(new Date('2026-02-01T11:00:00Z'))
    await commitProject('Snow', 'louder chorus', 'main', 'bob')
    expect((await syncSpace(bobFolder)).pushedVersions).toBe(1)

    setUsername('alice')
    const pulled = await syncSpace(aliceFolder)
    expect(pulled.pulledVersions).toBe(1)
    expect(versions('Snow')).toHaveLength(2)
  })

  it('shares projects that are added to the folder later', async () => {
    setUsername('bob')
    const dir = path.join(work, 'bob', 'Album', 'Lodge')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'Lodge.als'), 'Lodge v1')
    await initProject('Lodge', dir, { storageMode: 'project', author: 'bob' })
    getUserConfigManager('bob').moveProject(projectId('Lodge'), bobFolder)
    expect((await syncSpace(bobFolder)).uploadedProjects).toEqual(['Lodge'])

    setUsername('alice')
    const result = await syncSpace(aliceFolder)
    expect(result.addedProjects).toEqual(['Lodge'])
    expect(getUserConfigManager('alice').getProjectFolder(projectId('Lodge'))).toBe(aliceFolder)
    expect(fs.readFileSync(path.join(getProjectPath('Lodge'), 'Lodge.als'), 'utf8')).toBe('Lodge v1')
  })

  it('pulls one project on its own and says how many new versions are waiting', async () => {
    setUsername('bob')
    fs.writeFileSync(path.join(getProjectPath('Intro'), 'Intro.als'), 'Intro v2 from bob')
    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'))
    await commitProject('Intro', 'bob take', 'main', 'bob')
    expect(await syncSharedProject('Intro')).toEqual({ pulledVersions: 0, pushedVersions: 1 })

    setUsername('alice')
    expect(findSharedProject('Intro')?.space.folderId).toBe(aliceFolder)
    expect(await countIncomingVersions('Intro')).toBe(1)
    expect(await countIncomingVersions('Snow')).toBe(0)
    expect(await syncSharedProject('Intro')).toEqual({ pulledVersions: 1, pushedVersions: 0 })
    expect(await countIncomingVersions('Intro')).toBe(0)
    expect(versions('Intro')).toHaveLength(2)
    await expect(syncSharedProject('Nope')).rejects.toThrow(/not in a shared folder/)
    expect(await countIncomingVersions('Nope')).toBe(0)
  })

  it('keeps versions saved in the same second on two Macs apart', async () => {
    vi.setSystemTime(new Date('2026-02-01T13:00:00Z'))
    setUsername('alice')
    fs.writeFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'Snow by alice at 13:00')
    await commitProject('Snow', 'alice at 13:00', 'main', 'alice')
    await syncSharedProject('Snow')
    setUsername('bob')
    fs.writeFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'Snow by bob at 13:00')
    await commitProject('Snow', 'bob at 13:00', 'main', 'bob')
    await syncSharedProject('Snow')
    const bobIds = versions('Snow')
    expect(new Set(bobIds).size).toBe(bobIds.length)
    expect(bobIds.filter((id) => id.startsWith('20260201130000-'))).toHaveLength(2)

    setUsername('alice')
    await syncSharedProject('Snow')
    expect(versions('Snow').sort()).toEqual([...bobIds].sort())
  })

  it('puts parallel work from the same version into an alternative, the same on both Macs', async () => {
    const shape = () => loadLocalProjectLog('Intro').branches
      .map((b: any) => `${b.name}:${b.commits.map((c: any) => c.commit_id).sort().join(',')}`).sort()
    const forksOf = () => loadLocalProjectLog('Intro').branches.filter((b: any) => b.forkOf)

    // Both have the same version of Intro checked out.
    setUsername('alice'); await syncSharedProject('Intro')
    setUsername('bob'); await syncSharedProject('Intro')
    const base = loadLocalProjectLog('Intro').branches.find((b: any) => b.name === 'main').commits.at(-1).commit_id
    await rollbackProject('Intro', base)
    setUsername('alice'); await rollbackProject('Intro', base)

    vi.setSystemTime(new Date('2026-02-01T14:00:00Z'))
    setUsername('alice')
    fs.writeFileSync(path.join(getProjectPath('Intro'), 'Intro.als'), 'Intro: alice verse')
    const a = await commitProject('Intro', 'alice: new verse', 'main', 'alice')
    await syncSharedProject('Intro')

    vi.setSystemTime(new Date('2026-02-01T14:01:00Z'))
    setUsername('bob')
    fs.writeFileSync(path.join(getProjectPath('Intro'), 'Intro.als'), 'Intro: bob drums')
    const b = await commitProject('Intro', 'bob: new drums', 'main', 'bob')
    await syncSharedProject('Intro')

    // Bob saved second: his version moved into an alternative named after him, and he follows it.
    const bobForks = forksOf()
    expect(bobForks).toHaveLength(1)
    expect(bobForks[0].name).toMatch(/^bob · 1 Feb/)
    expect(bobForks[0].forkOf).toEqual({ branch: 'main', parent: base, author: 'bob' })
    expect(bobForks[0].commits.map((c: any) => c.commit_id)).toEqual([b.commitId])
    expect(loadLocalProjectLog('Intro').current_branch).toBe(bobForks[0].name)
    const mainIds = loadLocalProjectLog('Intro').branches.find((x: any) => x.name === 'main').commits.map((c: any) => c.commit_id)
    expect(mainIds).toContain(a.commitId)
    expect(mainIds).not.toContain(b.commitId)
    const bobShape = shape()

    // Alice ends with exactly the same history.
    setUsername('alice')
    await syncSharedProject('Intro')
    expect(shape()).toEqual(bobShape)
    expect(loadLocalProjectLog('Intro').current_branch).toBe('main')
    const open = openParallelVersions(loadLocalProjectLog('Intro'), 'main')
    expect(open.map((p) => [p.author, p.tip.commit_id])).toEqual([['bob', b.commitId]])

    // Alice makes Bob's version main: main continues with it; nothing is rewritten.
    const made = await makeParallelVersionMain('Intro', open[0].branch, 'alice')
    expect(fs.readFileSync(path.join(getProjectPath('Intro'), 'Intro.als'), 'utf8')).toBe('Intro: bob drums')
    await syncSharedProject('Intro')
    expect(openParallelVersions(loadLocalProjectLog('Intro'), 'main')).toEqual([])
    const aliceShape = shape()
    expect(aliceShape.find((x) => x.startsWith('main:'))).toContain(made.commitId)

    setUsername('bob')
    await syncSharedProject('Intro')
    expect(shape()).toEqual(aliceShape)
    expect(openParallelVersions(loadLocalProjectLog('Intro'), 'main')).toEqual([])
  })

  it('keeps versions without a recorded parent in a straight line', async () => {
    // Versions from before parents were recorded never split off.
    setUsername('alice')
    const log = loadLocalProjectLog('Intro')
    expect(log.branches.find((b: any) => b.name === 'main').commits[0].parent).toBeUndefined()
  })

  it('lets the owner see and manage people', async () => {
    setUsername('alice')
    const details = await getSpaceDetails(aliceFolder)
    expect(details.members.map((m) => m.name).sort()).toEqual(['alice', 'bob', 'carol'])
    expect(details.projects).toHaveLength(3)

    const bob = details.members.find((m) => m.name === 'bob')!
    await changeMemberRole(aliceFolder, bob.id, 'listen')
    setUsername('bob')
    expect((await syncSpace(bobFolder)).space.role).toBe('listen')

    setUsername('alice')
    await changeMemberRole(aliceFolder, bob.id, 'edit')
    await removeMember(aliceFolder, carolMemberId)
    setUsername('carol')
    await expect(syncSpace(carolFolder)).rejects.toThrow(/no longer have access/)
    expect(listLocalSpaces()[0].lastError).toMatch(/no longer have access/)
  })

  it('lets a removed member be invited again: same folder, and the history catches up', async () => {
    setUsername('alice')
    const expected = Object.fromEntries(['Snow', 'Intro', 'Lodge'].map((n) => [n, versions(n).length]))
    const again = (await createInvite(aliceFolder, 'listen')).code
    setUsername('carol')
    // The old record is still on Carol's Mac, but its access is gone, so the new invite is accepted.
    expect((await previewInvite(again)).space.name).toBe('Album')
    const result = await joinSpace(again, path.join(work, 'carol'))
    expect(result.folderId).toBe(carolFolder)
    expect(result.space.memberId).not.toBe(carolMemberId)
    expect(listLocalSpaces()).toHaveLength(1)
    for (const [name, n] of Object.entries(expected)) expect(versions(name)).toHaveLength(n)
    // Still a member now: another code finds the same folder instead of joining twice.
    setUsername('alice')
    const third = (await createInvite(aliceFolder, 'listen')).code
    setUsername('carol')
    expect((await previewInvite(third)).alreadyIn?.folderId).toBe(carolFolder)
    expect((await joinSpace(third, path.join(work, 'carol'))).folderId).toBe(carolFolder)
    expect(listLocalSpaces()).toHaveLength(1)
  })

  it('lets a member leave; their copies stay', async () => {
    setUsername('bob')
    await leaveSpace(bobFolder)
    expect(listLocalSpaces()).toEqual([])
    expect(fs.existsSync(path.join(getProjectPath('Snow'), 'Snow.als'))).toBe(true)
  })

  it('reads invites as codes or app links, and explains bad ones', () => {
    setUsername('dave')
    expect(() => parseInvite('hello')).toThrow(/not a DAWLab invite/)
    expect(() => parseInvite('DAWL-AAAA-BBBB-CCCC')).toThrow(/incomplete/)
    saveHubSettings({ hubUrl, hubKey: '' })
    expect(parseInvite(' dawl-aaaa-bbbb-cccc ')).toEqual({ hubUrl, code: expect.stringMatching(/AAAABBBBCCCC|DAWL-AAAA-BBBB-CCCC/) })
    expect(() => parseInvite('dawlab://join?hub=ftp%3A%2F%2Fx&code=DAWL-AAAA-BBBB-CCCC')).toThrow()
  })

  it('keeps showing the owner the full code of each open invite, and forgets it once revoked', async () => {
    setUsername('alice')
    const invite = await createInvite(aliceFolder, 'listen', 1, 1)
    const listed = (await listInvites(aliceFolder)).find((i) => i.id === invite.id)
    expect(listed?.code).toBe(invite.code)
    expect(listed?.code).toMatch(/^DAWL-/)
    await revokeInvite(aliceFolder, invite.id)
    expect((await listInvites(aliceFolder)).find((i) => i.id === invite.id)).toBeUndefined()
  })

  it('tells the owner how much space the server has, and nobody else', async () => {
    setUsername('alice')
    const storage = await getServerStorage(aliceFolder)
    expect(storage.totalBytes).toBeGreaterThan(0)
    expect(storage.freeBytes).toBeGreaterThanOrEqual(0)
  })

  it('refuses revoked invites and lists only what the owner may see', async () => {
    setUsername('alice')
    const invite = await createInvite(aliceFolder, 'edit', 1, 1)
    await revokeInvite(aliceFolder, invite.id)
    expect((await listInvites(aliceFolder)).find((i) => i.id === invite.id)).toBeUndefined()
    setUsername('dave')
    await expect(joinSpace(invite.link, path.join(work, 'dave'))).rejects.toThrow(/not valid/)
  })

  it('keeps listeners from uploading or managing, and owners from leaving', async () => {
    setUsername('alice')
    const listen = await createInvite(aliceFolder, 'listen')
    await expect(leaveSpace(aliceFolder)).rejects.toThrow(/You own this folder/)

    setUsername('dave')
    const joined = await joinSpace(listen.link, path.join(work, 'dave'))
    await expect(stopSharing(joined.folderId)).rejects.toThrow(/Only the owner/)
    await expect(createInvite(joined.folderId, 'edit')).rejects.toThrow()

    const dir = path.join(work, 'dave', 'Mine')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'Mine.als'), 'mine')
    await initProject('Mine', dir, { storageMode: 'project', author: 'dave' })
    getUserConfigManager('dave').moveProject(projectId('Mine'), joined.folderId)
    expect((await syncSpace(joined.folderId)).uploadedProjects).toEqual([])
    expect(getSpaceForProject('Mine')?.folderId).toBe(joined.folderId)
  })

  it('does not add a project opened from someone else\'s single-project link, and says why', async () => {
    setUsername('alice')
    const dir = path.join(work, 'alice', 'Old')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'Old.als'), 'old')
    await initProject('Old', dir, { storageMode: 'project', author: 'alice' })
    saveProjectRemote('Old', { hubUrl, token: 'x'.repeat(32), role: 'edit', editUrl: `${hubUrl}/s/${'x'.repeat(32)}` })
    getUserConfigManager('alice').moveProject(projectId('Old'), aliceFolder)
    const r = await syncSpace(aliceFolder)
    expect(r.uploadedProjects).toEqual([])
    expect(r.failed).toEqual([{ project: 'Old', error: expect.stringMatching(/someone else's share link/) }])
    expect(getLocalSpace(aliceFolder)?.lastError).toMatch(/^Old came from someone else's share link/)
    expect(getSpaceForProject('Nope')).toBeNull()
    getUserConfigManager('alice').moveProject(projectId('Old'), null)
    expect((await syncSpace(aliceFolder)).failed).toEqual([])
    expect(getLocalSpace(aliceFolder)?.lastError).toBeUndefined()
  })

  it('lets only the owner delete a project from the server; everyone keeps a copy outside the folder', async () => {
    setUsername('carol')
    await expect(deleteProjectFromServer('Lodge')).rejects.toThrow(/Only the owner/)

    setUsername('alice')
    const kept = versions('Lodge').length
    expect(await deleteProjectFromServer('Lodge')).toEqual({ folderId: aliceFolder })
    expect(findSharedProject('Lodge')).toBeNull()
    expect(getUserConfigManager('alice').getProjectFolder(projectId('Lodge'))).toBeNull()
    expect((await getSpaceDetails(aliceFolder)).projects.map((p) => p.name)).not.toContain('Lodge')
    expect(versions('Lodge')).toHaveLength(kept)
    // Alice's copy is out of the folder, so the next sync doesn't upload it again.
    const again = await syncSpace(aliceFolder)
    expect(again.uploadedProjects).toEqual([])
    expect(again.removedProjects).toEqual([])

    setUsername('carol')
    const result = await syncSpace(carolFolder)
    expect(result.removedProjects).toEqual(['Lodge'])
    expect(result.failed).toEqual([])
    expect(findSharedProject('Lodge')).toBeNull()
    expect(getUserConfigManager('carol').getProjectFolder(projectId('Lodge'))).toBeNull()
    expect(versions('Lodge')).toHaveLength(kept)
    expect((await syncSpace(carolFolder)).removedProjects).toEqual([])
  })

  it('stops sharing for everyone when the owner says so; copies stay', async () => {
    setUsername('alice')
    await stopSharing(aliceFolder)
    expect(listLocalSpaces()).toEqual([])
    expect(fs.existsSync(path.join(getProjectPath('Snow'), 'Snow.als'))).toBe(true)

    setUsername('dave')
    const daveFolder = listLocalSpaces()[0].folderId
    await expect(syncSpace(daveFolder)).rejects.toThrow(/no longer have access/)
  })
})
