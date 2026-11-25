/**
 * New versions from collaborators: a macOS notification when DAWLab is in the
 * background (window open, minimised or closed; the app keeps running in the
 * Dock), a toast when it is in front, and a list with an unread count for the
 * bell in the Library. Nothing arrives while DAWLab is quit: real push would
 * need Apple's push service and a signed app.
 */
import type { BrowserWindow, IpcMain } from 'electron'
import { Notification, app, dialog } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getUserDir, getUsername } from '../dawvcs/core/constants'
import { loadRegistry } from '../dawvcs/core/registry'
import { listLocalSpaces, listSpaceProjects, readSpaceProjectLog, localNameOf } from '../sync/spaces-client'
import { requestSpaceSync } from '../sync/auto-sync'
import { markRead, setMuted, setSound, soundPlan, unreadCount, SOUND_EXTENSIONS, type Alert, type FeedState, type SoundPlan, type VersionNotice } from './version-feed'
import { checkForNewVersions, feedStore, startWatching } from './version-watcher'

const store = feedStore(() => getUserDir())

/** What the renderer sees: the list, the unread count, the switches, and which folders can be muted. */
function snapshot(state: FeedState = store.load()) {
  return {
    notices: state.notices,
    unread: unreadCount(state),
    enabled: state.enabled,
    sound: state.sound,
    soundFileName: state.soundFile ? path.basename(state.soundFile) : null,
    muted: state.muted,
    folders: listLocalSpaces().map((s) => ({ folderId: s.folderId, name: s.name })),
  }
}

export type FeedSnapshot = ReturnType<typeof snapshot>

/** The rooster crow (docs/THIRD_PARTY_SOUNDS.md), shipped next to the app. */
const roosterFile = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'sounds', 'rooster.mp3')
  : path.join(app.getAppPath(), 'resources', 'sounds', 'rooster.mp3'))

/** Plays the sound DAWLab chose, through macOS (works with the window closed). */
function playSound(play: SoundPlan['play']) {
  if (!play || process.platform !== 'darwin') return
  const file = play.kind === 'rooster' ? roosterFile() : play.path
  if (!fs.existsSync(file)) {
    console.warn('[notify] Sound file is missing:', file)
    return
  }
  execFile('/usr/bin/afplay', ['-v', '0.7', file], (err) => {
    if (err) console.warn('[notify] Could not play the sound:', err.message)
  })
}

export function registerNotificationIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, showWindow: () => Promise<BrowserWindow>) {
  const publish = (state?: FeedState) => {
    const snap = snapshot(state)
    if (process.platform === 'darwin') app.setBadgeCount(snap.enabled ? snap.unread : 0)
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('notifications-changed', snap)
    return snap
  }

  /** Opens the project on the version, bringing DAWLab forward (and back, if its window was closed). */
  const open = async (n: Pick<VersionNotice, 'folderId' | 'hubProjectId' | 'projectName' | 'commitId'>) => {
    const projectName = localNameOf(n.folderId, n.hubProjectId) ?? n.projectName
    const projectId = loadRegistry()[projectName]?.project_id
    const win = await showWindow()
    store.save(markRead(store.load(), projectName))
    publish()
    if (projectId) win.webContents.send('open-project', { projectName, projectId: String(projectId), commitId: n.commitId })
  }

  const announce = (alerts: Alert[]) => {
    const plan = soundPlan(store.load(), alerts.length)
    const win = getWindow()
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) {
      win.webContents.send('version-alerts', alerts.map(({ title, body, target }) => ({ title, body, target })))
      playSound(plan.play)
      return
    }
    if (!Notification.isSupported()) return
    // One sound for the batch, however many notifications it shows.
    playSound(plan.play)
    for (const [i, alert] of alerts.entries()) {
      const note = new Notification({ title: alert.title, body: alert.body, silent: plan.silent || i > 0 })
      note.on('click', () => { void open(alert.target) })
      note.show()
    }
  }

  const check = async () => {
    if (!getUsername()) return
    const r = await checkForNewVersions({
      spaces: () => listLocalSpaces().filter((s) => !s.accessClosed).map((s) => ({ folderId: s.folderId, name: s.name })),
      listProjects: async (folderId) => (await listSpaceProjects(folderId)).map((p) => ({ id: p.id, name: localNameOf(folderId, p.id) ?? p.name, updatedAt: p.updatedAt })),
      readLog: readSpaceProjectLog,
      me: getUsername,
      load: store.load,
      save: store.save,
    })
    if (!r.added.length) return
    publish()
    if (r.alerts.length) announce(r.alerts)
    // Bring the new versions down, so they are there when the project opens.
    for (const folderId of r.changedFolders) void requestSpaceSync(folderId)
  }

  ipcMain.handle('notifications-get', () => publish())
  ipcMain.handle('notifications-mark-read', (_ev, projectName?: string) => {
    const name = typeof projectName === 'string' && projectName ? projectName : undefined
    const state = markRead(store.load(), name)
    store.save(state)
    return publish(state)
  })
  ipcMain.handle('notifications-set-enabled', (_ev, enabled: boolean) => {
    const state = { ...store.load(), enabled: enabled === true }
    store.save(state)
    return publish(state)
  })
  ipcMain.handle('notifications-set-muted', (_ev, folderId: string, muted: boolean) => {
    if (typeof folderId !== 'string' || !folderId) throw new Error('No shared folder given.')
    const state = setMuted(store.load(), folderId, muted === true)
    store.save(state)
    return publish(state)
  })
  ipcMain.handle('notifications-set-sound', (_ev, sound: unknown) => {
    const state = setSound(store.load(), sound)
    store.save(state)
    return publish(state)
  })
  ipcMain.handle('notifications-choose-sound', async () => {
    const win = getWindow()
    const options = { title: 'Choose a notification sound', properties: ['openFile' as const], filters: [{ name: 'Sounds', extensions: SOUND_EXTENSIONS }] }
    const picked = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return publish()
    const state = setSound(store.load(), 'custom', picked.filePaths[0])
    store.save(state)
    playSound({ kind: 'file', path: picked.filePaths[0] })
    return publish(state)
  })
  ipcMain.handle('notifications-preview-sound', () => {
    const state = store.load()
    if (state.sound === 'system') {
      // macOS plays its own sound with a notification: show a sample one.
      if (Notification.isSupported()) new Notification({ title: 'DAWLab', body: 'This is how a new version sounds.' }).show()
      return true
    }
    playSound(soundPlan(state, 1).play)
    return true
  })
  ipcMain.handle('notifications-open', (_ev, noticeId: string) => {
    const n = store.load().notices.find((x) => x.id === noticeId)
    return n ? open(n).then(() => true) : false
  })
  ipcMain.handle('notifications-check-now', () => check().then(() => publish()))

  return startWatching(check)
}
