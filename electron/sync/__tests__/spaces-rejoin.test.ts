// @vitest-environment node
/**
 * Coming back to a shared folder. Whatever happened in between (the old invite
 * was revoked, you were removed, you left, you deleted the folder or its files),
 * a new invite to the same folder must find the folder you already have and
 * bring its versions up to date: no second "Album", no "Snow (2)", no lost work.
 *
 * Each scenario gets its own owner, folder and people on one in-process hub.
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
import {
  shareFolder, syncSpace, joinSpace, createInvite, getSpaceDetails, listLocalSpaces, getLocalSpace,
  removeMember, previewInvite, leaveSpace, revokeInvite, listInvites, changeMemberRole, stopSharing,
} from '../spaces-client'
import { createHub } from '../../../server/src/app.ts'
import { FsStorage } from '../../../server/src/storage.ts'

const KEY = 'secret-key-for-rejoin-tests'
const work = path.join(MOCK_HOME, 'work')
let server: http.Server
let hubUrl = ''

beforeAll(async () => {
  server = http.createServer(createHub({ storage: new FsStorage(path.join(MOCK_HOME, 'hub-data')), createKey: KEY }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  hubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.close()
  fs.rmSync(MOCK_HOME, { recursive: true, force: true })
})

// ------------------------------------------------------------- helpers

const as = (user: string) => setUsername(user)
const projectId = (name: string) => String(loadRegistry()[name].project_id)
const versionCount = (name: string) =>
  (loadLocalProjectLog(name)?.branches ?? []).reduce((n: number, b: any) => n + b.commits.length, 0)
const albumFolders = (user: string) => getUserConfigManager(user).getFolders().filter((f) => f.name === 'Album')
const projectNames = () => Object.keys(loadRegistry()).sort()

/** A world for one scenario: `<tag>-owner` shares "Album" with Intro and Snow. */
async function world(tag: string) {
  const owner = `${tag}-owner`
  as(owner)
  saveHubSettings({ hubUrl, hubKey: KEY })
  const manager = getUserConfigManager(owner)
  const folderId = manager.createFolder('Album', null).id
  for (const song of ['Intro', 'Snow']) {
    const dir = path.join(work, tag, owner, song)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${song}.als`), `${song} v1`)
    await initProject(song, dir, { storageMode: 'project', author: owner })
    manager.moveProject(projectId(song), folderId)
  }
  await shareFolder(folderId)

  const invite = async (role: 'edit' | 'listen' = 'edit', expiresInDays = 7, maxUses = 10) => {
    as(owner)
    return createInvite(folderId, role, expiresInDays, maxUses)
  }
  const join = async (user: string, code: string) => {
    as(user)
    return joinSpace(code, path.join(work, tag, user))
  }
  /** Saves a version of `song` as `user` and syncs it up. */
  const save = async (user: string, folder: string, song: string, content: string) => {
    as(user)
    fs.writeFileSync(path.join(getProjectPath(song), `${song}.als`), content)
    await commitProject(song, content, 'main', user)
    await syncSpace(folder)
  }
  /** The owner's version count after pulling what others pushed. */
  const ownerVersions = async (song: string) => { as(owner); await syncSpace(folderId); return versionCount(song) }
  const members = async () => { as(owner); return (await getSpaceDetails(folderId)).members }
  /** People are per scenario, so one scenario's Library never leaks into another. */
  const u = (name: string) => `${tag}-${name}`
  return { owner, folderId, invite, join, save, ownerVersions, members, u }
}

// ------------------------------------------------------------- scenarios

describe('a new invite while you are still in the folder (the old one was revoked)', () => {
  it('finds your folder, does not spend the invite or add you twice, and syncs what you missed', async () => {
    const w = await world('still')
    const first = await w.invite()
    const joined = await w.join(w.u('bob'), first.code)
    as(w.owner)
    await revokeInvite(w.folderId, first.id)
    await w.save(w.owner, w.folderId, 'Snow', 'Snow v2')

    const second = await w.invite()
    as(w.u('bob'))
    const preview = await previewInvite(second.code)
    expect(preview.alreadyIn?.folderId).toBe(joined.folderId)

    const again = await w.join(w.u('bob'), second.code)
    expect(again.folderId).toBe(joined.folderId)
    expect(again.space.memberId).toBe(joined.space.memberId)
    expect(again.pulledVersions).toBe(1)
    const ownerCount = await w.ownerVersions('Snow')
    as(w.u('bob'))
    expect(versionCount('Snow')).toBe(ownerCount)
    expect(albumFolders(w.u('bob'))).toHaveLength(1)
    as(w.u('bob'))
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(listLocalSpaces()).toHaveLength(1)

    expect((await w.members()).filter((m) => m.name === w.u('bob'))).toHaveLength(1)
    as(w.owner)
    expect((await listInvites(w.folderId)).find((i) => i.id === second.id)?.uses).toBe(0)
  })

  it('pushes versions you saved while the invite was being replaced', async () => {
    const w = await world('push')
    const first = await w.invite()
    const joined = await w.join(w.u('bob'), first.code)
    as(w.u('bob'))
    fs.writeFileSync(path.join(getProjectPath('Intro'), 'Intro.als'), 'Intro from bob')
    await commitProject('Intro', 'offline idea', 'main', w.u('bob'))
    as(w.owner)
    await revokeInvite(w.folderId, first.id)

    const again = await w.join(w.u('bob'), (await w.invite()).code)
    expect(again.folderId).toBe(joined.folderId)
    expect(again.pushedVersions).toBe(1)
    expect(await w.ownerVersions('Intro')).toBe(2)
  })

  it('works with the same code entered twice, as a link, and for the owner', async () => {
    const w = await world('twice')
    const invite = await w.invite()
    const joined = await w.join(w.u('bob'), invite.code)
    const again = await w.join(w.u('bob'), invite.code)
    expect(again.folderId).toBe(joined.folderId)
    const viaLink = await w.join(w.u('bob'), invite.link)
    expect(viaLink.folderId).toBe(joined.folderId)

    as(w.owner)
    const own = await joinSpace(invite.code, path.join(work, 'twice', 'elsewhere'))
    expect(own.folderId).toBe(w.folderId)
    expect(own.space.role).toBe('owner')
    expect(albumFolders(w.owner)).toHaveLength(1)
    expect((await w.members()).length).toBe(2)
  })

  it('keeps your role: an edit invite does not turn a listener into an editor', async () => {
    const w = await world('role')
    const joined = await w.join(w.u('carol'), (await w.invite('listen')).code)
    const again = await w.join(w.u('carol'), (await w.invite('edit')).code)
    expect(again.folderId).toBe(joined.folderId)
    expect(again.space.role).toBe('listen')
  })

  it('takes a role the owner changed since', async () => {
    const w = await world('promoted')
    const joined = await w.join(w.u('carol'), (await w.invite('listen')).code)
    as(w.owner)
    await changeMemberRole(w.folderId, joined.space.memberId, 'edit')
    const again = await w.join(w.u('carol'), (await w.invite('listen')).code)
    expect(again.space.role).toBe('edit')
    as(w.u('carol'))
    expect(getLocalSpace(joined.folderId)?.role).toBe('edit')
  })

  it('puts the Library folder back if you deleted it, with the projects in it', async () => {
    const w = await world('nofolder')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.u('bob'))
    getUserConfigManager(w.u('bob')).deleteFolder(joined.folderId)
    expect(albumFolders(w.u('bob'))).toHaveLength(0)

    const again = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.u('bob'))
    const folders = albumFolders(w.u('bob'))
    expect(folders).toHaveLength(1)
    expect(again.folderId).toBe(folders[0].id)
    for (const song of ['Intro', 'Snow']) expect(getUserConfigManager(w.u('bob')).getProjectFolder(projectId(song))).toBe(folders[0].id)
    expect(projectNames()).toEqual(['Intro', 'Snow'])
  })
})

describe('a new invite after the owner removed you', () => {
  it('uses the same folder and projects, and brings back everything missed', async () => {
    const w = await world('removed')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.owner)
    await removeMember(w.folderId, joined.space.memberId)
    await w.save(w.owner, w.folderId, 'Snow', 'Snow v2')
    await w.save(w.owner, w.folderId, 'Snow', 'Snow v3')

    as(w.u('bob'))
    await expect(syncSpace(joined.folderId)).rejects.toThrow()

    const again = await w.join(w.u('bob'), (await w.invite()).code)
    expect(again.folderId).toBe(joined.folderId)
    expect(again.space.memberId).not.toBe(joined.space.memberId)
    expect(again.failed).toEqual([])
    as(w.u('bob'))
    expect(versionCount('Snow')).toBe(3)
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(albumFolders(w.u('bob'))).toHaveLength(1)
    expect((await w.members()).filter((m) => m.name === w.u('bob'))).toHaveLength(1)
  })

  it('downloads projects again whose files you deleted', async () => {
    const w = await world('wiped')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.owner)
    await removeMember(w.folderId, joined.space.memberId)
    as(w.u('bob'))
    fs.rmSync(getProjectPath('Intro'), { recursive: true, force: true })

    await w.join(w.u('bob'), (await w.invite()).code)
    as(w.u('bob'))
    expect(fs.readFileSync(path.join(getProjectPath('Intro'), 'Intro.als'), 'utf8')).toBe('Intro v1')
  })

  it('gets projects added while you were out, and keeps versions you saved meanwhile', async () => {
    const w = await world('meanwhile')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.owner)
    await removeMember(w.folderId, joined.space.memberId)
    const dir = path.join(work, 'meanwhile', w.owner, 'Lodge')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'Lodge.als'), 'Lodge v1')
    await initProject('Lodge', dir, { storageMode: 'project', author: w.owner })
    getUserConfigManager(w.owner).moveProject(projectId('Lodge'), w.folderId)
    await syncSpace(w.folderId)

    as(w.u('bob'))
    fs.writeFileSync(path.join(getProjectPath('Intro'), 'Intro.als'), 'Intro offline')
    await commitProject('Intro', 'offline', 'main', w.u('bob'))

    const again = await w.join(w.u('bob'), (await w.invite()).code)
    expect(again.addedProjects).toEqual(['Lodge'])
    expect(again.pushedVersions).toBe(1)
    as(w.u('bob'))
    expect(projectNames()).toEqual(['Intro', 'Lodge', 'Snow'])
    expect(await w.ownerVersions('Intro')).toBe(2)
  })

  it('a removed listener can come back as an editor', async () => {
    const w = await world('relisten')
    const joined = await w.join(w.u('carol'), (await w.invite('listen')).code)
    as(w.owner)
    await removeMember(w.folderId, joined.space.memberId)
    const again = await w.join(w.u('carol'), (await w.invite('edit')).code)
    expect(again.space.role).toBe('edit')
    as(w.u('carol'))
    expect(fs.readFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'utf8')).toBe('Snow v1')
  })
})

describe('a new invite after you left the folder yourself', () => {
  it('finds the folder and projects you kept: no second Album, no "Snow (2)"', async () => {
    const w = await world('left')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.u('bob'))
    await leaveSpace(joined.folderId)
    await w.save(w.owner, w.folderId, 'Snow', 'Snow v2')

    const again = await w.join(w.u('bob'), (await w.invite()).code)
    expect(again.failed).toEqual([])
    expect(again.folderId).toBe(joined.folderId)
    as(w.u('bob'))
    expect(albumFolders(w.u('bob'))).toHaveLength(1)
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(versionCount('Snow')).toBe(2)
  })

  it('starts fresh, under the same names, when you also deleted the folder and the files', async () => {
    const w = await world('gone')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.u('bob'))
    await leaveSpace(joined.folderId)
    getUserConfigManager(w.u('bob')).deleteFolder(joined.folderId)
    fs.rmSync(path.join(work, 'gone', w.u('bob')), { recursive: true, force: true })

    const again = await w.join(w.u('bob'), (await w.invite()).code)
    expect(again.failed).toEqual([])
    as(w.u('bob'))
    expect(albumFolders(w.u('bob'))).toHaveLength(1)
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(fs.readFileSync(path.join(getProjectPath('Snow'), 'Snow.als'), 'utf8')).toBe('Snow v1')
  })
})

describe('invites that cannot be used', () => {
  it('a revoked code is refused and changes nothing', async () => {
    const w = await world('revoked')
    const invite = await w.invite()
    as(w.owner)
    await revokeInvite(w.folderId, invite.id)
    as(w.u('dave'))
    await expect(previewInvite(invite.code)).rejects.toThrow(/not valid/)
    await expect(joinSpace(invite.code, path.join(work, 'revoked', w.u('dave')))).rejects.toThrow(/not valid/)
    expect(listLocalSpaces()).toEqual([])
    expect(albumFolders(w.u('dave'))).toHaveLength(0)
  })

  it('a used-up code is refused for someone new', async () => {
    const w = await world('usedup')
    const invite = await w.invite('edit', 7, 1)
    await w.join(w.u('bob'), invite.code)
    as(w.u('dave'))
    await expect(joinSpace(invite.code, path.join(work, 'usedup', w.u('dave')))).rejects.toThrow(/not valid/)
    expect(listLocalSpaces()).toEqual([])
  })

  it('a server that cannot be reached changes nothing', async () => {
    const w = await world('offline')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.u('bob'))
    const before = JSON.stringify(listLocalSpaces())
    await expect(joinSpace('DAWL-7KQ4-MX2P-9TRB', path.join(work, 'offline', w.u('bob')))).rejects.toThrow()
    expect(JSON.stringify(listLocalSpaces())).toBe(before)
    expect(getLocalSpace(joined.folderId)?.folderId).toBe(joined.folderId)
  })

  it('an invite to another folder on the same server makes a separate folder', async () => {
    const a = await world('two-a')
    const b = await world('two-b')
    const first = await a.join(a.u('erin'), (await a.invite()).code)
    const code = (await b.invite()).code
    as(a.u('erin'))
    const second = await joinSpace(code, path.join(work, 'two-b', a.u('erin')))
    expect(second.folderId).not.toBe(first.folderId)
    expect(listLocalSpaces()).toHaveLength(2)
  })
})

describe('when access is closed', () => {
  it('a removed member sees the folder as closed, keeps everything, and a new code reopens it', async () => {
    const w = await world('closed')
    const bob = w.u('bob')
    const joined = await w.join(bob, (await w.invite()).code)
    as(w.owner)
    await removeMember(w.folderId, joined.space.memberId)
    as(bob)
    await expect(syncSpace(joined.folderId)).rejects.toThrow(/no longer have access/)
    expect(getLocalSpace(joined.folderId)?.accessClosed).toBe(true)
    expect(projectNames()).toEqual(['Intro', 'Snow'])
    expect(fs.existsSync(path.join(getProjectPath('Snow'), 'Snow.als'))).toBe(true)

    const again = await w.join(bob, (await w.invite()).code)
    as(bob)
    expect(getLocalSpace(again.folderId)?.accessClosed).toBeUndefined()
  })

  it('members see it closed when the owner stops sharing', async () => {
    const w = await world('stopped')
    const joined = await w.join(w.u('bob'), (await w.invite()).code)
    as(w.owner)
    await stopSharing(w.folderId)
    as(w.u('bob'))
    await expect(syncSpace(joined.folderId)).rejects.toThrow()
    expect(getLocalSpace(joined.folderId)?.accessClosed).toBe(true)
  })

  it('"Stop syncing this folder" forgets the share but keeps the Library folder and the copies', async () => {
    const w = await world('stopsync')
    const bob = w.u('bob')
    const joined = await w.join(bob, (await w.invite()).code)
    as(w.owner)
    await removeMember(w.folderId, joined.space.memberId)
    as(bob)
    await syncSpace(joined.folderId).catch(() => undefined)
    await leaveSpace(joined.folderId)
    expect(getLocalSpace(joined.folderId)).toBeNull()
    expect(albumFolders(bob)).toHaveLength(1)
    expect(getUserConfigManager(bob).getProjectFolder(projectId('Snow'))).toBe(joined.folderId)
    expect(versionCount('Snow')).toBe(1)
  })

  it('being offline is not a closed folder', async () => {
    const w = await world('flaky')
    const bob = w.u('bob')
    const joined = await w.join(bob, (await w.invite()).code)
    as(bob)
    const spacesFile = path.join(MOCK_HOME, '.dawlab', 'users', bob, 'spaces.json')
    const all = JSON.parse(fs.readFileSync(spacesFile, 'utf8'))
    all[joined.folderId].hubUrl = 'http://127.0.0.1:9'
    fs.writeFileSync(spacesFile, JSON.stringify(all))
    await expect(syncSpace(joined.folderId)).rejects.toThrow()
    expect(getLocalSpace(joined.folderId)?.accessClosed).toBeFalsy()
    expect(getLocalSpace(joined.folderId)?.lastError).toBeTruthy()
  })
})

