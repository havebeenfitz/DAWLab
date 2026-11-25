import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  getHubSettings, saveHubSettings, getProjectRemote, removeProjectRemote,
  shareProject, syncProject, openSharedProject,
} from './hub-client'

/** IPC for DAWLab Hub sharing. Progress text is sent on `hub-sync-progress`. */
export function registerHubIpc(ipcMain: IpcMain) {
  const progress = (ev: IpcMainInvokeEvent, key: string) => (message: string) => {
    if (!ev.sender.isDestroyed()) ev.sender.send('hub-sync-progress', { key, message })
  }

  ipcMain.handle('hub-get-settings', () => getHubSettings())
  ipcMain.handle('hub-save-settings', (_ev, settings) => saveHubSettings(settings ?? {}))
  ipcMain.handle('hub-get-remote', (_ev, projectName: string) => getProjectRemote(projectName))
  ipcMain.handle('hub-unlink-project', (_ev, projectName: string) => {
    removeProjectRemote(projectName)
    return { success: true }
  })
  ipcMain.handle('hub-share-project', (ev, projectName: string) => shareProject(projectName, progress(ev, projectName)))
  ipcMain.handle('hub-sync-project', (ev, projectName: string) => syncProject(projectName, progress(ev, projectName)))
  ipcMain.handle('hub-open-shared', (ev, link: string, parentFolder: string) =>
    openSharedProject(link, parentFolder, progress(ev, 'open')),
  )
}
