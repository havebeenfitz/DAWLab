/**
 * New versions from collaborators: a macOS notification when DAWLab is in the
 * background (window open, minimised or closed; the app keeps running in the
 * Dock), a toast when it is in front, and a list with an unread count for the
 * bell in the Library. The hub pushes changes over one event stream per
 * shared folder (sync/hub-events.ts); nothing is polled. Nothing arrives
 * while DAWLab is quit: that would need Apple's push service and a signed app.
 */
import type { BrowserWindow, IpcMain } from 'electron'
import { Notification, app, dialog, powerMonitor } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getUserDir, getUsername } from '../dawvcs/core/constants'
import { loadRegistry } from '../dawvcs/core/registry'
import { listLocalSpaces, listSpaceProjects, readSpaceProjectLog, localNameOf, onSpacesChanged } from '../sync/spaces-client'
import { createHubEvents } from '../sync/hub-events'
import { requestSpaceSync } from '../sync/auto-sync'
import { alertsFor, withSummaries, markRead, setMuted, setSound, soundPlan, unreadCount, SOUND_EXTENSIONS, type Alert, type FeedState, type SoundPlan, type VersionNotice } from './version-feed'
import { checkForNewVersions, feedStore } from './version-watcher'
import { logicSummaryOfVersion } from '../dawvcs/operations/version-changes'

/** How long a notification waits for the new versions to come down, so it can say what changed. */
const SUMMARY_WAIT_MS = 45_000

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

  /** Looks for new versions in the given shared folders (all of them when none are given). */
  const check = async (only?: string[]): Promise<string[]> => {
    if (!getUsername()) return []
    const r = await checkForNewVersions({
      spaces: () => listLocalSpaces()
        .filter((s) => !s.accessClosed && (!only || only.includes(s.folderId)))
        .map((s) => ({ folderId: s.folderId, name: s.name })),
      listProjects: async (folderId) => (await listSpaceProjects(folderId)).map((p) => ({ id: p.id, name: localNameOf(folderId, p.id) ?? p.name, updatedAt: p.updatedAt })),
      readLog: readSpaceProjectLog,
      me: getUsername,
      load: store.load,
      save: store.save,
    })
    if (!r.added.length) return []
    publish()
    // Bring the new versions down, so they are there when the project opens and
    // the notification can say what changed. It waits a little, never long.
    const synced = Promise.allSettled(r.changedFolders.map((folderId) => requestSpaceSync(folderId)))
    const describe = () => {
      const local = (n: VersionNotice) => localNameOf(n.folderId, n.hubProjectId) ?? n.projectName
      const summaries = new Map<string, string>()
      for (const n of r.added) {
        const s = logicSummaryOfVersion(local(n), n.commitId)
        if (s) summaries.set(n.id, s)
      }
      if (summaries.size) {
        store.save(withSummaries(store.load(), summaries))
        publish()
      }
      return summaries
    }
    const inTime = await Promise.race([synced.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), SUMMARY_WAIT_MS))])
    const summaries = inTime ? describe() : new Map<string, string>()
    const added = r.added.map((n) => (summaries.has(n.id) ? { ...n, summary: summaries.get(n.id) } : n))
    const alerts = alertsFor(store.load(), added)
    if (alerts.length) announce(alerts)
    if (!inTime) void synced.then(describe)
    return r.changedFolders
  }

  // One check at a time, so two events never write the feed at once.
  let checking: Promise<unknown> = Promise.resolve()
  const checkFolder = (folderId: string, syncAnyway: boolean) => {
    checking = checking.then(async () => {
      const changed = await check([folderId]).catch((err) => {
        console.warn('[notify] Check failed:', (err as Error)?.message ?? err)
        return [] as string[]
      })
      // The hub said there is something new: pull it even if no notice came of it.
      if (syncAnyway && !changed.includes(folderId)) await requestSpaceSync(folderId)
    })
    return checking
  }

  const events = createHubEvents({
    targets: () => listLocalSpaces().filter((s) => !s.accessClosed).map(({ folderId, hubUrl, token }) => ({ folderId, hubUrl, token })),
    // Opened: on a reconnect something may have been missed, so look once.
    onOpen: (folderId, first) => { if (!first) void checkFolder(folderId, false) },
    onChange: (folderId, event) => {
      if (event.kind === 'versions') void checkFolder(folderId, true)
      else void requestSpaceSync(folderId)
    },
    // The folder's sync finds out what happened and marks access closed; the stream list follows.
    onGone: (folderId) => { void requestSpaceSync(folderId) },
  })

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

  const unsubscribe = onSpacesChanged(() => events.reconcile())
  // After sleep the streams are dead: reconnect at once instead of waiting for the stall timer.
  const reconnect = () => events.reconnectAll()
  void app.whenReady().then(() => {
    powerMonitor.on('resume', reconnect)
    events.reconcile()
  })
  return () => {
    unsubscribe()
    powerMonitor.off('resume', reconnect)
    events.stop()
  }
}
