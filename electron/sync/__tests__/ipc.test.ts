// @vitest-environment node
/** The sharing IPC: what reaches the renderer (never tokens or the server password) and the connection check. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({
  hubClient: {
    getHubSettings: vi.fn(), saveHubSettings: vi.fn(), getProjectRemote: vi.fn(), removeProjectRemote: vi.fn(),
    shareProject: vi.fn(), syncProject: vi.fn(), openSharedProject: vi.fn(), onParallelPlacement: vi.fn(),
  },
  spaces: {
    listLocalSpaces: vi.fn(), getLocalSpace: vi.fn(), getSpaceForProject: vi.fn(), shareFolder: vi.fn(), joinSpace: vi.fn(),
    getSpaceDetails: vi.fn(), listInvites: vi.fn(), createInvite: vi.fn(), revokeInvite: vi.fn(), changeMemberRole: vi.fn(),
    removeMember: vi.fn(), leaveSpace: vi.fn(), stopSharing: vi.fn(), previewInvite: vi.fn(), countIncomingVersions: vi.fn(),
  },
  autoSync: { requestProjectSync: vi.fn(), requestSharedProjectSync: vi.fn(), requestSpaceSync: vi.fn(), startAutoSync: vi.fn(), syncAllSpaces: vi.fn() },
  manager: { createFolder: vi.fn(), moveProject: vi.fn(), getProjectFolder: vi.fn(), getFolders: vi.fn() },
  registry: { loadRegistry: vi.fn() },
}))

vi.mock('../hub-client', () => m.hubClient)
vi.mock('../spaces-client', () => m.spaces)
vi.mock('../auto-sync', () => m.autoSync)
vi.mock('../../dawvcs/core/config', () => ({ getUserConfigManager: () => m.manager }))
vi.mock('../../dawvcs/core/registry', () => m.registry)
vi.mock('../../dawvcs/core/constants', () => ({ getUsername: () => 'max' }))

import { registerHubIpc } from '../ipc'

const space = {
  folderId: 'f1', hubUrl: 'https://hub.test', spaceId: 's1', token: 'SECRET-MEMBER-TOKEN', memberId: 'm1', role: 'owner',
  name: 'Album', localRoot: '/Music/DAWLab/Album', projects: { p1: 'Snow', p2: 'Intro' }, members: [], lastSync: 'x',
}

describe('sharing IPC', () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const sent: Array<{ channel: string; payload: any }> = []
  const win = { isDestroyed: () => false, webContents: { send: (channel: string, payload: any) => sent.push({ channel, payload }) } }
  const ev = { sender: { isDestroyed: () => false, send: vi.fn() } }
  const call = (channel: string, ...args: any[]) => handlers.get(channel)!(ev, ...args)
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handlers.clear()
    sent.length = 0
    Object.values({ ...m.hubClient, ...m.spaces, ...m.autoSync, ...m.manager, ...m.registry }).forEach((f) => f.mockReset())
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    registerHubIpc({ handle: (ch: string, fn: any) => handlers.set(ch, fn) } as any, () => win as any)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('registers every channel the renderer uses and starts background sync', () => {
    for (const ch of [
      'hub-get-settings', 'hub-save-settings', 'hub-test-connection', 'hub-get-remote', 'hub-unlink-project', 'hub-share-project',
      'hub-sync-project', 'hub-open-shared', 'hub-list-spaces', 'hub-get-space', 'hub-get-project-space', 'hub-space-details',
      'hub-share-folder', 'hub-sync-space', 'hub-sync-all', 'hub-project-saved', 'hub-project-share-context',
      'hub-make-folder-for-project', 'hub-default-join-dir', 'hub-preview-invite', 'hub-join-space', 'hub-list-invites',
      'hub-create-invite', 'hub-revoke-invite', 'hub-change-role', 'hub-remove-member', 'hub-leave-space', 'hub-stop-sharing',
    ]) expect(handlers.has(ch), ch).toBe(true)
    expect(m.autoSync.startAutoSync).toHaveBeenCalledTimes(1)
  })

  it('never hands the server password to the renderer', async () => {
    m.hubClient.getHubSettings.mockReturnValue({ hubUrl: 'https://hub.test', hubKey: 'pw' })
    expect(await call('hub-get-settings')).toEqual({ hubUrl: 'https://hub.test', hasKey: true })
    m.hubClient.saveHubSettings.mockReturnValue({ hubUrl: 'https://hub.test', hubKey: '' })
    expect(await call('hub-save-settings', { hubUrl: 'hub.test' })).toEqual({ hubUrl: 'https://hub.test', hasKey: false })
  })

  it('never hands tokens to the renderer', async () => {
    m.spaces.listLocalSpaces.mockReturnValue([space])
    m.spaces.getLocalSpace.mockReturnValue(space)
    m.spaces.getSpaceForProject.mockReturnValue(space)
    m.hubClient.getProjectRemote.mockReturnValue({ hubUrl: 'h', token: 'LEGACY-TOKEN', role: 'listen', editUrl: '', listenUrl: 'u' })
    m.hubClient.shareProject.mockResolvedValue({ pushed: 1, pulled: 0, remote: { hubUrl: 'h', token: 'LEGACY-TOKEN', editUrl: 'e' } })
    m.spaces.shareFolder.mockResolvedValue({ space })
    m.spaces.joinSpace.mockResolvedValue({ folderId: 'f1', space, addedProjects: [], failed: [] })
    m.spaces.getSpaceDetails.mockResolvedValue({ space: {}, me: {}, members: [], projects: [], local: space })
    m.autoSync.requestSpaceSync.mockResolvedValue({ space })

    const outputs = [
      await call('hub-list-spaces'), await call('hub-get-space', 'f1'), await call('hub-get-project-space', 'Snow'),
      await call('hub-get-remote', 'Snow'), await call('hub-share-project', 'Snow'), await call('hub-share-folder', 'f1'),
      await call('hub-join-space', 'DAWL-…', '/dir'), await call('hub-space-details', 'f1'), await call('hub-sync-space', 'f1'),
    ]
    const text = JSON.stringify(outputs)
    expect(text).not.toContain('SECRET-MEMBER-TOKEN')
    expect(text).not.toContain('LEGACY-TOKEN')
    expect(outputs[0][0]).toMatchObject({ folderId: 'f1', role: 'owner', projectCount: 2 })
  })

  it('tells the window when sharing a folder starts, finishes or fails', async () => {
    m.spaces.shareFolder.mockResolvedValueOnce({ space })
    await call('hub-share-folder', 'f1')
    expect(sent.map((s) => s.payload.state)).toEqual(['syncing', 'synced'])

    sent.length = 0
    m.spaces.shareFolder.mockRejectedValueOnce(new Error('Connect a DAWLab server first'))
    await expect(call('hub-share-folder', 'f1')).rejects.toThrow(/Connect/)
    expect(sent.at(-1)!.payload).toMatchObject({ state: 'error', error: 'Connect a DAWLab server first' })
  })

  it('puts a project into a new folder of its own, inside the folder it was in', async () => {
    m.registry.loadRegistry.mockReturnValue({ Snow: { project_id: 'p1' } })
    m.manager.getProjectFolder.mockReturnValue('parent')
    m.manager.getFolders.mockReturnValue([{ id: 'parent', name: 'Demos' }])
    m.manager.createFolder.mockReturnValue({ id: 'new', name: 'Snow' })
    expect(await call('hub-project-share-context', 'Snow')).toEqual({ projectId: 'p1', folderId: 'parent', folderName: 'Demos' })
    expect(await call('hub-make-folder-for-project', 'Snow')).toEqual({ folderId: 'new', folderName: 'Snow' })
    expect(m.manager.createFolder).toHaveBeenCalledWith('Snow', 'parent')
    expect(m.manager.moveProject).toHaveBeenCalledWith('p1', 'new')

    m.registry.loadRegistry.mockReturnValue({})
    expect(await call('hub-project-share-context', 'Gone')).toBeNull()
    expect(() => call('hub-make-folder-for-project', 'Gone')).toThrow(/not found/)
  })

  describe('checking the server connection', () => {
    beforeEach(() => m.hubClient.getHubSettings.mockReturnValue({ hubUrl: '', hubKey: 'saved-pw' }))

    it('needs an address', async () => {
      expect(await call('hub-test-connection', {})).toEqual({ ok: false, message: 'Enter the server address.' })
      expect(await call('hub-test-connection', { hubUrl: 'http://' })).toMatchObject({ ok: false, message: /not a valid address/ })
    })

    it('accepts the password when the server answers 400 to an empty folder name, and creates nothing', async () => {
      fetchMock.mockResolvedValue({ status: 400 })
      expect(await call('hub-test-connection', { hubUrl: 'hub.test/', hubKey: 'pw' })).toEqual({ ok: true, message: 'Connected. The password works.' })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://hub.test/api/spaces')
      expect(init.headers['X-Hub-Key']).toBe('pw')
      expect(JSON.parse(init.body)).toEqual({ name: '', memberName: '' })
    })

    it('uses the saved password when none is typed', async () => {
      fetchMock.mockResolvedValue({ status: 400 })
      await call('hub-test-connection', { hubUrl: 'https://hub.test' })
      expect(fetchMock.mock.calls[0][1].headers['X-Hub-Key']).toBe('saved-pw')
    })

    it('explains a refused password, other answers, and an unreachable server', async () => {
      fetchMock.mockResolvedValueOnce({ status: 404 })
      expect(await call('hub-test-connection', { hubUrl: 'https://hub.test' })).toMatchObject({ ok: false, message: /did not accept the password/ })
      fetchMock.mockResolvedValueOnce({ status: 502 })
      expect(await call('hub-test-connection', { hubUrl: 'https://hub.test' })).toMatchObject({ ok: false, message: 'The server answered 502.' })
      fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
      expect(await call('hub-test-connection', { hubUrl: 'https://hub.test' })).toMatchObject({ ok: false, message: /Could not reach the server/ })
    })
  })

  it('passes invite management through to the server client', async () => {
    m.spaces.createInvite.mockResolvedValue({ code: 'DAWL-AAAA-BBBB-CCCC' })
    await call('hub-create-invite', 'f1', 'listen', 3, 2)
    expect(m.spaces.createInvite).toHaveBeenCalledWith('f1', 'listen', 3, 2)
    m.spaces.revokeInvite.mockResolvedValue(undefined)
    expect(await call('hub-revoke-invite', 'f1', 'i1')).toBe(true)
    m.spaces.changeMemberRole.mockResolvedValue({})
    await call('hub-change-role', 'f1', 'm2', 'edit')
    expect(m.spaces.changeMemberRole).toHaveBeenCalledWith('f1', 'm2', 'edit')
    m.spaces.removeMember.mockResolvedValue(undefined)
    m.spaces.leaveSpace.mockResolvedValue(undefined)
    m.spaces.stopSharing.mockResolvedValue(undefined)
    expect(await call('hub-remove-member', 'f1', 'm2')).toBe(true)
    expect(await call('hub-leave-space', 'f1')).toBe(true)
    expect(await call('hub-stop-sharing', 'f1')).toBe(true)
    await call('hub-project-saved', 'Snow')
    expect(m.autoSync.requestProjectSync).toHaveBeenCalledWith('Snow')
    expect(await call('hub-default-join-dir')).toMatch(/Music[\\/]DAWLab$/)
  })

  it('reports what a manual folder sync did, and why it failed', async () => {
    m.autoSync.requestSpaceSync.mockResolvedValueOnce({
      space, pulledVersions: 3, pushedVersions: 1, addedProjects: ['Lodge'], uploadedProjects: [], failed: [],
    })
    const ok = await call('hub-sync-space-now', 'f1')
    expect(ok).toMatchObject({ ok: true, pulledVersions: 3, pushedVersions: 1, addedProjects: ['Lodge'] })
    expect(JSON.stringify(ok)).not.toContain('SECRET-MEMBER-TOKEN')

    m.autoSync.requestSpaceSync.mockResolvedValueOnce({ space, pulledVersions: 0, pushedVersions: 0, addedProjects: [], uploadedProjects: [], failed: [{ project: 'Snow', error: 'disk full' }] })
    expect(await call('hub-sync-space-now', 'f1')).toMatchObject({ ok: false, error: 'Snow: disk full' })

    m.autoSync.requestSpaceSync.mockResolvedValueOnce(null)
    m.spaces.getLocalSpace.mockReturnValueOnce({ ...space, lastError: 'You no longer have access' })
    expect(await call('hub-sync-space-now', 'f1')).toEqual({ ok: false, error: 'You no longer have access' })
  })

  it('pulls one project and counts versions waiting on the hub, treating failures as none', async () => {
    m.autoSync.requestSharedProjectSync.mockResolvedValueOnce({ pulledVersions: 2, pushedVersions: 0 })
    expect(await call('hub-sync-project-now', 'Snow')).toEqual({ pulledVersions: 2, pushedVersions: 0 })
    expect(m.autoSync.requestSharedProjectSync).toHaveBeenCalledWith('Snow', expect.any(Function))
    m.spaces.countIncomingVersions.mockResolvedValueOnce(4)
    expect(await call('hub-project-incoming', 'Snow')).toBe(4)
    m.spaces.countIncomingVersions.mockRejectedValueOnce(new Error('offline'))
    expect(await call('hub-project-incoming', 'Snow')).toBe(0)
  })

  it('tells the window when a save went into a parallel version', () => {
    const listener = m.hubClient.onParallelPlacement.mock.calls.at(-1)![0]
    const moves = [{ commitId: 'c', message: 'mine', from: 'main', fork: 'max · 25 Nov' }]
    listener('Snow', moves)
    expect(sent.at(-1)).toEqual({ channel: 'hub-parallel-placed', payload: { projectName: 'Snow', moves } })
  })
})

