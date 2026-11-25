// @vitest-environment node
/**
 * Coming back to a shared folder: invites revoked and made again, people
 * removed and invited again, leaving and joining again, the owner stopping and
 * starting sharing. The rule everywhere: the same folder is recognised, no
 * project is downloaded twice, nothing on disk is lost, and the history catches up.
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
  const dir = path.join(os.tmpdir(), `dawlab-rejoin-test-${process.pid}-${Date.now()}`)
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
import { rollbackProject } from '../../dawvcs/operations/rollback'
import {
  shareFolder, syncSpace, joinSpace, createInvite, getSpaceDetails, listLocalSpaces,
  removeMember, changeMemberRole, previewInvite, leaveSpace, revokeInvite, stopSharing, listInvites,
} from '../spaces-client'
import { createHub } from '../../../server/src/app.ts'
import { FsStorage } from '../../../server/src/storage.ts'


const versions = (projectName: string) =>
  loadLocalProjectLog(projectName).branches.flatMap((b: any) => b.commits.map((c: any) => String(c.commit_id))).sort()

const projectId = (projectName: string) => String(loadRegistry()[projectName].project_id)
const projectNames = () => Object.keys(loadRegistry()).sort()
const foldersNamed = (user: string, name: string) => getUserConfigManager(user).getFolders().filter((f: any) => f.name === name)

let tick = 0
/** Versions are ordered by time; every save gets its own minute. */
const nextMinute = () => vi.setSystemTime(new Date(Date.UTC(2026, 1, 1, 10, ++tick)))

describe('Joining a shared folder again', () => {
  let server: http.Server
  let hubUrl = ''
  const work = path.join(MOCK_HOME, 'work')
  let albumAlice = ''
  let albumBob = ''
  let bobMemberId = ''

  async function save(user: string, song: string, text: string, message: string) {
    setUsername(user)
    fs.writeFileSync(path.join(getProjectPath(song), `${song}.als`), text)
    nextMinute()
    await commitProject(song, message, 'main', user)
  }

  /** Alice saves and sends it to the hub. */
  async function aliceSaves(song: string, text: string, message: string) {
    await save('alice', song, text, message)
    await syncSpace(albumAlice)
  }

  async function invite(role: 'edit' | 'listen') {
    setUsername('alice')
    return createInvite(albumAlice, role)
  }

  beforeAll(async () => {
    server = http.createServer(createHub({ storage: new FsStorage(path.join(MOCK_HOME, 'hub-data')), createKey: 'k-for-tests-123' }))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    hubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    vi.useFakeTimers({ toFake: ['Date'] })
    nextMinute()

    setUsername('alice')
    saveHubSettings({ hubUrl, hubKey: 'k-for-tests-123' })
    const manager = getUserConfigManager('alice')
    albumAlice = manager.createFolder('Album', null).id
    for (const song of ['Intro', 'Snow']) {
      const dir = path.join(work, 'alice', song)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${song}.als`), `${song} v1`)
      await initProject(song, dir, { storageMode: 'project', author: 'alice' })
      manager.moveProject(projectId(song), albumAlice)
    }
    await shareFolder(albumAlice)
  })

  afterAll(() => {
    vi.useRealTimers()
    server?.close()
    fs.rmSync(MOCK_HOME, { recursive: true, force: true })
  })

  it('setup: Bob joins as a collaborator', async () => {
    const inv = await invite('edit')
    setUsername('bob')
    const r = await joinSpace(inv.code, path.join(work, 'bob'))
    albumBob = r.folderId
    bobMemberId = r.space.memberId
    expect(projectNames()).toEqual(['Intro', 'Snow'])
  })

  it('revoking an invite does not remove people who already joined with it', async () => {
    setUsername('alice')
    const [used] = await listInvites(albumAlice)
    await revokeInvite(albumAlice, used.id)
    await aliceSaves('Snow', 'Snow v2', 'alice after revoke')
    setUsername('bob')
    const r = await syncSpace(albumBob)
    expect(r.pulledVersions).toBe(1)
    expect(r.space.lastError).toBeUndefined()
  })

  it('a revoked code is refused; a new code for the same folder lets a new person in', async () => {
    setUsername('alice')
    const old = await createInvite(albumAlice, 'edit')
    await revokeInvite(albumAlice, old.id)
    setUsername('erin')
    await expect(previewInvite(old.code)).rejects.toThrow(/not valid/)
    await expect(joinSpace(old.code, path.join(work, 'erin'))).rejects.toThrow(/not valid/)
    expect(listLocalSpaces()).toEqual([])

    const fresh = await invite('edit')
    setUsername('erin')
    const r = await joinSpace(fresh.code, path.join(work, 'erin'))
    expect(r.failed).toEqual([])
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    setUsername('alice')
    const aliceSnow = versions('Snow')
    setUsername('erin')
    expect(versions('Snow')).toEqual(aliceSnow)
  })

  it('a new code sent to someone already in the folder finds that folder and syncs it, without being used up', async () => {
    const inv = await invite('edit')
    setUsername('bob')
    const preview = await previewInvite(inv.code)
    expect(preview.alreadyIn?.folderId).toBe(albumBob)
    const again = await joinSpace(inv.code, path.join(work, 'bob'))
    expect(again.folderId).toBe(albumBob)
    expect(listLocalSpaces()).toHaveLength(1)
    setUsername('alice')
    expect((await listInvites(albumAlice)).find((i) => i.id === inv.id)?.uses).toBe(0)
    expect((await getSpaceDetails(albumAlice)).members.filter((m) => m.name === 'bob')).toHaveLength(1)
  })

  it('a removed collaborator keeps working offline; invited again, the same folder comes back and nothing is lost', async () => {
    setUsername('alice')
    await removeMember(albumAlice, bobMemberId)
    await aliceSaves('Intro', 'Intro v2', 'alice while bob is out')

    // Bob doesn't know yet: he saves, and his sync is refused.
    await save('bob', 'Snow', 'Snow from bob offline', 'bob while removed')
    setUsername('bob')
    await expect(syncSpace(albumBob)).rejects.toThrow(/no longer have access/)
    const bobSnowBefore = versions('Snow')

    const inv = await invite('edit')
    setUsername('bob')
    expect((await previewInvite(inv.code)).space.name).toBe('Album')
    const r = await joinSpace(inv.code, path.join(work, 'bob'))
    expect(r.folderId).toBe(albumBob)
    expect(r.failed).toEqual([])
    expect(r.addedProjects).toEqual([])
    expect(r.pushedVersions).toBe(1)
    expect(r.pulledVersions).toBe(1)
    bobMemberId = r.space.memberId
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(foldersNamed('bob', 'Album')).toHaveLength(1)
    expect(listLocalSpaces()).toHaveLength(1)
    expect(versions('Snow')).toEqual(expect.arrayContaining(bobSnowBefore))
    // His file on disk is untouched.
    expect(fs.readFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'utf8')).toBe('Snow from bob offline')

    setUsername('alice')
    await syncSpace(albumAlice)
    const aliceSnow = versions('Snow'), aliceIntro = versions('Intro')
    setUsername('bob')
    expect(versions('Snow')).toEqual(aliceSnow)
    expect(versions('Intro')).toEqual(aliceIntro)
  })

  it('a collaborator who left and joins again gets the same folder back, without "Snow (2)"', async () => {
    setUsername('bob')
    await leaveSpace(albumBob)
    expect(listLocalSpaces()).toEqual([])
    await aliceSaves('Snow', 'Snow v3', 'alice while bob left')

    const inv = await invite('edit')
    setUsername('bob')
    const r = await joinSpace(inv.code, path.join(work, 'bob'))
    expect(r.folderId).toBe(albumBob)
    expect(r.addedProjects).toEqual([])
    expect(r.failed).toEqual([])
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(foldersNamed('bob', 'Album')).toHaveLength(1)
    setUsername('alice')
    const aliceSnow = versions('Snow')
    setUsername('bob')
    expect(versions('Snow')).toEqual(aliceSnow)
  })

  it('a listener invited again as a collaborator gets the role, and the project files', async () => {
    const inv = await invite('listen')
    setUsername('dan')
    const first = await joinSpace(inv.code, path.join(work, 'dan'))
    expect(first.space.role).toBe('listen')
    expect(fs.existsSync(path.join(getProjectPath('Snow'), 'Snow.als'))).toBe(false)

    setUsername('alice')
    await removeMember(albumAlice, first.space.memberId)
    const again = await invite('edit')
    setUsername('dan')
    const r = await joinSpace(again.code, path.join(work, 'dan'))
    expect(r.folderId).toBe(first.folderId)
    expect(r.space.role).toBe('edit')
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(fs.readFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'utf8')).toBe('Snow v3')
  })

  it('a listener the owner makes a collaborator gets the files on the next sync, old versions included', async () => {
    const inv = await invite('listen')
    setUsername('gina')
    const joined = await joinSpace(inv.code, path.join(work, 'gina'))
    expect(fs.existsSync(path.join(getProjectPath('Snow'), 'Snow.als'))).toBe(false)
    setUsername('alice')
    await changeMemberRole(albumAlice, joined.space.memberId, 'edit')
    setUsername('gina')
    const r = await syncSpace(joined.folderId)
    expect(r.space.role).toBe('edit')
    expect(r.pulledVersions).toBe(0)
    expect(fs.readFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'utf8')).toBe('Snow v3')
    // The oldest version, kept from listening days, now has its files too.
    const oldest = versions('Snow')[0]
    await rollbackProject('Snow', oldest)
    expect(fs.readFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'utf8')).toBe('Snow v1')
  })

  it('when the owner stops sharing and shares again, members joining the new share keep their folder and copies', async () => {
    setUsername('alice')
    await stopSharing(albumAlice)
    const reshared = await shareFolder(albumAlice)
    expect(reshared.space.spaceId).not.toBe(undefined)
    await aliceSaves('Intro', 'Intro v3', 'after resharing')

    const inv = await invite('edit')
    setUsername('bob')
    // Bob's old link is dead, so the new invite is accepted.
    const r = await joinSpace(inv.code, path.join(work, 'bob'))
    expect(r.folderId).toBe(albumBob)
    expect(r.addedProjects).toEqual([])
    expect(r.failed).toEqual([])
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(listLocalSpaces()).toHaveLength(1)
    expect(listLocalSpaces()[0].spaceId).toBe(reshared.space.spaceId)
    setUsername('alice')
    const aliceIntro = versions('Intro')
    setUsername('bob')
    expect(versions('Intro')).toEqual(aliceIntro)
  })

  it('never picks up an unrelated local project that only has the same name', async () => {
    setUsername('frank')
    const dir = path.join(work, 'frank', 'Snow')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'Snow.als'), 'frank own snow')
    await initProject('Snow', dir, { storageMode: 'project', author: 'frank' })
    const inv = await invite('edit')
    setUsername('frank')
    const r = await joinSpace(inv.code, path.join(work, 'frank'))
    expect(r.addedProjects.sort()).toEqual(['Intro', 'Snow (2)'])
    expect(fs.readFileSync(path.join(dir, 'Snow.als'), 'utf8')).toBe('frank own snow')
    expect(getUserConfigManager('frank').getProjectFolder(projectId('Snow'))).not.toBe(r.folderId)
  })

  it('a removed member gets a plain error, not a crash, until invited again', async () => {
    setUsername('alice')
    const bob = (await getSpaceDetails(albumAlice)).members.find((m) => m.name === 'bob')!
    await removeMember(albumAlice, bob.id)
    setUsername('bob')
    const folder = listLocalSpaces()[0].folderId
    await expect(syncSpace(folder)).rejects.toThrow(/Ask its owner to invite you again/)
    expect(listLocalSpaces()[0].lastError).toMatch(/no longer have access/)
  })
})
