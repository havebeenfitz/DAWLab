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
import {
  shareFolder, syncSpace, joinSpace, createInvite, getSpaceDetails, getSpaceForProject, listLocalSpaces,
  changeMemberRole, removeMember, previewInvite, leaveSpace, parseInvite, revokeInvite, stopSharing, listInvites,
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
    expect(result.addedProjects.sort()).toEqual(['Intro', 'Snow'])
    expect(result.pushedVersions).toBe(2)
    expect(result.space.role).toBe('owner')
    expect(getSpaceForProject('Snow')?.folderId).toBe(aliceFolder)

    const again = await syncSpace(aliceFolder)
    expect(again.pushedVersions).toBe(0)
    expect(again.addedProjects).toEqual([])
  })

  it('creates invites that show what they open without using them up', async () => {
    setUsername('alice')
    const edit = await createInvite(aliceFolder, 'edit')
    expect(edit.code).toMatch(/^DAWL-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    expect(edit.link.startsWith('dawlab://join?')).toBe(true)
    editInvite = edit.link
    listenInvite = (await createInvite(aliceFolder, 'listen')).link

    await expect(previewInvite(editInvite)).rejects.toThrow(/already in “Album”/)

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
    expect((await syncSpace(bobFolder)).addedProjects).toEqual(['Lodge'])

    setUsername('alice')
    const result = await syncSpace(aliceFolder)
    expect(result.addedProjects).toEqual(['Lodge'])
    expect(getUserConfigManager('alice').getProjectFolder(projectId('Lodge'))).toBe(aliceFolder)
    expect(fs.readFileSync(path.join(getProjectPath('Lodge'), 'Lodge.als'), 'utf8')).toBe('Lodge v1')
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

  it('lets a member leave; their copies stay', async () => {
    setUsername('bob')
    await leaveSpace(bobFolder)
    expect(listLocalSpaces()).toEqual([])
    expect(fs.existsSync(path.join(getProjectPath('Snow'), 'Snow.als'))).toBe(true)
  })

  it('reads invites as codes or app links, and explains bad ones', () => {
    setUsername('dave')
    expect(() => parseInvite('hello')).toThrow(/not a DAWLab invite/)
    expect(() => parseInvite('DAWL-AAAA-BBBB-CCCC')).toThrow(/needs a DAWLab server/)
    saveHubSettings({ hubUrl, hubKey: '' })
    expect(parseInvite(' dawl-aaaa-bbbb-cccc ')).toEqual({ hubUrl, code: expect.stringMatching(/AAAABBBBCCCC|DAWL-AAAA-BBBB-CCCC/) })
    expect(() => parseInvite('dawlab://join?hub=ftp%3A%2F%2Fx&code=DAWL-AAAA-BBBB-CCCC')).toThrow()
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
    expect((await syncSpace(joined.folderId)).addedProjects).toEqual([])
    expect(getSpaceForProject('Mine')?.folderId).toBe(joined.folderId)
  })

  it('leaves projects that were shared on their own before folders alone', async () => {
    setUsername('alice')
    const dir = path.join(work, 'alice', 'Old')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'Old.als'), 'old')
    await initProject('Old', dir, { storageMode: 'project', author: 'alice' })
    saveProjectRemote('Old', { hubUrl, token: 'x'.repeat(32), role: 'edit', editUrl: `${hubUrl}/s/${'x'.repeat(32)}` })
    getUserConfigManager('alice').moveProject(projectId('Old'), aliceFolder)
    expect((await syncSpace(aliceFolder)).addedProjects).toEqual([])
    expect(getSpaceForProject('Nope')).toBeNull()
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
