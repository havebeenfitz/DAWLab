import { hubFetch } from './hub-fetch'
import type { TransferProgress } from '../../shared/transfer-progress'
import os from 'os'
import path from 'path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { getUsername } from '../dawvcs/core/constants'
import { getUserConfigManager } from '../dawvcs/core/config'
import { loadRegistry } from '../dawvcs/core/registry'
import {
  getHubSettings, saveHubSettings, getProjectRemote, removeProjectRemote, onParallelPlacement,
  shareProject, syncProject, openSharedProject,
} from './hub-client'
import {
  listLocalSpaces, getLocalSpace, getSpaceForProject, shareFolder, joinSpace, getSpaceDetails,
  listInvites, getServerStorage, createInvite, revokeInvite, changeMemberRole, removeMember, leaveSpace, stopSharing,
  deleteProjectFromServer, previewInvite, countIncomingVersions,
} from './spaces-client'
import { forceStopSync, requestProjectSync, requestSharedProjectSync, requestSpaceSync, startAutoSync, syncAllSpaces, type SyncStatus } from './auto-sync'

/** Never hand tokens to the renderer: it only needs to know what is shared and how. */
const publicSpace = (s: ReturnType<typeof getLocalSpace>) => s && {
  folderId: s.folderId, hubUrl: s.hubUrl, spaceId: s.spaceId, memberId: s.memberId, role: s.role, name: s.name,
  localRoot: s.localRoot, projectCount: Object.keys(s.projects).length, members: s.members ?? [],
  lastSync: s.lastSync, lastError: s.lastError, accessClosed: !!s.accessClosed,
}

/**
 * IPC for DAWLab Hub sharing. Progress text is sent on `hub-sync-progress`,
 * background sync state of shared folders on `hub-status`.
 */
export function registerHubIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  const progress = (ev: IpcMainInvokeEvent, key: string) => (message: string, transfer?: TransferProgress) => {
    if (!ev.sender.isDestroyed()) ev.sender.send('hub-sync-progress', { key, message, ...(transfer ? { transfer } : {}) })
  }
  const sendStatus = (status: SyncStatus) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('hub-status', status)
  }

  // Your version went into a parallel alternative: tell the window, it says why and where.
  onParallelPlacement((projectName, moves) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('hub-parallel-placed', { projectName, moves })
  })

  // ---- server connection
  ipcMain.handle('hub-get-settings', () => {
    const s = getHubSettings()
    return { hubUrl: s.hubUrl, hasKey: Boolean(s.hubKey) }
  })
  ipcMain.handle('hub-save-settings', (_ev, settings: { hubUrl?: string; hubKey?: string }) => {
    const s = saveHubSettings(settings ?? {})
    return { hubUrl: s.hubUrl, hasKey: Boolean(s.hubKey) }
  })
  ipcMain.handle('hub-test-connection', (_ev, settings: { hubUrl?: string; hubKey?: string }) => testConnection(settings ?? {}))

  // ---- projects shared one by one (before shared folders)
  ipcMain.handle('hub-get-remote', (_ev, projectName: string) => {
    const r = getProjectRemote(projectName)
    return r && { hubUrl: r.hubUrl, role: r.role ?? 'edit', editUrl: r.editUrl, listenUrl: r.listenUrl, lastSync: r.lastSync }
  })
  ipcMain.handle('hub-unlink-project', (_ev, projectName: string) => {
    removeProjectRemote(projectName)
    return { success: true }
  })
  ipcMain.handle('hub-share-project', (ev, projectName: string) => shareProject(projectName, progress(ev, projectName)).then(stripRemote))
  ipcMain.handle('hub-sync-project', (ev, projectName: string) => syncProject(projectName, progress(ev, projectName)).then(stripRemote))
  ipcMain.handle('hub-open-shared', (ev, link: string, parentFolder: string) =>
    openSharedProject(link, parentFolder, progress(ev, 'open')),
  )

  // ---- shared folders
  ipcMain.handle('hub-list-spaces', () => listLocalSpaces().map(publicSpace))
  ipcMain.handle('hub-get-space', (_ev, folderId: string) => publicSpace(getLocalSpace(folderId)))
  ipcMain.handle('hub-get-project-space', (_ev, projectName: string) => publicSpace(getSpaceForProject(projectName)))
  ipcMain.handle('hub-space-details', async (_ev, folderId: string) => {
    const d = await getSpaceDetails(folderId)
    return { space: d.space, me: d.me, members: d.members, projects: d.projects, local: publicSpace(d.local) }
  })
  ipcMain.handle('hub-share-folder', async (ev, folderId: string) => {
    sendStatus({ folderId, state: 'syncing' })
    try {
      const r = await shareFolder(folderId, progress(ev, folderId))
      sendStatus({ folderId, state: 'synced', lastSync: r.space.lastSync })
      return publicSpace(r.space)
    } catch (err) {
      sendStatus({ folderId, state: 'error', error: String((err as Error)?.message ?? err) })
      throw err
    }
  })
  ipcMain.handle('hub-sync-space', (_ev, folderId: string) => requestSpaceSync(folderId, { byHand: true }).then((r) => r && publicSpace(r.space)))
  // Only offered while a folder's syncs loop or hang: stops it until the next sync by hand.
  ipcMain.handle('hub-force-stop-sync', (_ev, folderId: string) => { forceStopSync(folderId); return true })
  // One project of a shared folder: pull and push now, and how many versions are waiting on the hub.
  ipcMain.handle('hub-sync-project-now', (ev, projectName: string) => requestSharedProjectSync(projectName, progress(ev, projectName)))
  ipcMain.handle('hub-project-incoming', (_ev, projectName: string) => countIncomingVersions(projectName).catch(() => 0))
  // "Sync now": pull and push one shared folder right away; reports what happened.
  ipcMain.handle('hub-sync-space-now', async (_ev, folderId: string) => {
    const r = await requestSpaceSync(folderId, { byHand: true })
    if (!r) return { ok: false, error: getLocalSpace(folderId)?.lastError ?? 'Sync failed.' }
    return {
      ok: r.failed.length === 0,
      pulledVersions: r.pulledVersions,
      pushedVersions: r.pushedVersions,
      addedProjects: r.addedProjects,
      uploadedProjects: r.uploadedProjects,
      removedProjects: r.removedProjects,
      renamedProjects: r.renamedProjects,
      failed: r.failed,
      error: r.failed[0] ? `${r.failed[0].project}: ${r.failed[0].error}` : undefined,
      folder: publicSpace(r.space),
    }
  })
  ipcMain.handle('hub-sync-all', () => syncAllSpaces().then(() => true))
  ipcMain.handle('hub-project-saved', (_ev, projectName: string) => { requestProjectSync(projectName); return true })
  ipcMain.handle('hub-project-share-context', (_ev, projectName: string) => projectShareContext(projectName))
  ipcMain.handle('hub-make-folder-for-project', (_ev, projectName: string) => {
    const ctx = projectShareContext(projectName)
    if (!ctx) throw new Error(`Project '${projectName}' not found`)
    const manager = getUserConfigManager(getUsername())
    const folder = manager.createFolder(projectName, ctx.folderId)
    manager.moveProject(ctx.projectId, folder.id)
    return { folderId: folder.id, folderName: folder.name }
  })
  ipcMain.handle('hub-default-join-dir', () => path.join(os.homedir(), 'Music', 'DAWLab'))
  ipcMain.handle('hub-preview-invite', (_ev, input: string) => previewInvite(input))
  ipcMain.handle('hub-join-space', async (ev, input: string, parentDir: string) => {
    const r = await joinSpace(input, parentDir, progress(ev, 'join'))
    sendStatus({ folderId: r.folderId, state: r.failed.length ? 'error' : 'synced', lastSync: r.space.lastSync })
    return { ...publicSpace(r.space), addedProjects: r.addedProjects, failed: r.failed }
  })
  ipcMain.handle('hub-list-invites', (_ev, folderId: string) => listInvites(folderId))
  ipcMain.handle('hub-server-storage', (_ev, folderId: string) => getServerStorage(folderId))
  ipcMain.handle('hub-create-invite', (_ev, folderId: string, role: 'edit' | 'listen', days?: number, uses?: number) =>
    createInvite(folderId, role, days, uses))
  ipcMain.handle('hub-revoke-invite', (_ev, folderId: string, inviteId: string) => revokeInvite(folderId, inviteId).then(() => true))
  ipcMain.handle('hub-change-role', (_ev, folderId: string, memberId: string, role: 'edit' | 'listen') =>
    changeMemberRole(folderId, memberId, role))
  ipcMain.handle('hub-remove-member', (_ev, folderId: string, memberId: string) => removeMember(folderId, memberId).then(() => true))
  ipcMain.handle('hub-leave-space', (_ev, folderId: string) => leaveSpace(folderId).then(() => true))
  ipcMain.handle('hub-stop-sharing', (_ev, folderId: string) => stopSharing(folderId).then(() => true))
  ipcMain.handle('hub-delete-project-from-server', (_ev, projectName: string) => deleteProjectFromServer(projectName))

  startAutoSync(sendStatus)
}

/** Which Library folder a project is in, so the app can offer to share that folder. */
function projectShareContext(projectName: string) {
  const entry = loadRegistry()[projectName]
  if (!entry) return null
  const manager = getUserConfigManager(getUsername())
  const folderId = manager.getProjectFolder(entry.project_id)
  const folder = folderId ? manager.getFolders().find((f) => f.id === folderId) : undefined
  return { projectId: String(entry.project_id), folderId: folder?.id ?? null, folderName: folder?.name ?? null }
}

const stripRemote = <T extends { remote: { token?: string } }>(r: T) => {
  const { token: _t, ...remote } = r.remote
  return { ...r, remote }
}

/** Checks the address answers like a DAWLab server, and that the password is accepted, without creating anything. */
async function testConnection(settings: { hubUrl?: string; hubKey?: string }): Promise<{ ok: boolean; message: string }> {
  const saved = getHubSettings()
  const hubUrl = (settings.hubUrl ?? saved.hubUrl ?? '').trim()
  const hubKey = settings.hubKey ?? saved.hubKey
  if (!hubUrl) return { ok: false, message: 'Enter the server address.' }
  let base: string
  try {
    base = new URL(/^https?:\/\//.test(hubUrl) ? hubUrl : `https://${hubUrl}`).origin
  } catch {
    return { ok: false, message: 'That is not a valid address.' }
  }
  try {
    // An empty space name is refused with a readable 400 only after the password check passes.
    const res = await hubFetch(`${base}/api/spaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(hubKey ? { 'X-Hub-Key': hubKey } : {}) },
      body: JSON.stringify({ name: '', memberName: '' }),
    })
    if (res.status === 400) return { ok: true, message: 'Connected. The password works.' }
    if (res.status === 404) return { ok: false, message: 'The server did not accept the password, or this is not a DAWLab server.' }
    return { ok: false, message: `The server answered ${res.status}.` }
  } catch {
    return { ok: false, message: 'Could not reach the server. Check the address and your internet connection.' }
  }
}
