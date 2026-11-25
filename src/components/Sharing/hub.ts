/** Renderer-side types and calls for DAWLab Hub sharing (see electron/sync). */
export interface HubSettings { hubUrl: string; hubKey: string }
export interface ProjectRemote { hubUrl: string; token: string; editUrl: string; listenUrl?: string; lastSync?: string }
export interface SyncResult { pushed: number; pulled: number; uploadedFiles: number; downloadedFiles: number; remote: ProjectRemote }

export const hub = {
  getSettings: (): Promise<HubSettings> => window.ipcRenderer.invoke('hub-get-settings'),
  saveSettings: (s: Partial<HubSettings>): Promise<HubSettings> => window.ipcRenderer.invoke('hub-save-settings', s),
  getRemote: (projectName: string): Promise<ProjectRemote | null> => window.ipcRenderer.invoke('hub-get-remote', projectName),
  share: (projectName: string): Promise<SyncResult> => window.ipcRenderer.invoke('hub-share-project', projectName),
  sync: (projectName: string): Promise<SyncResult> => window.ipcRenderer.invoke('hub-sync-project', projectName),
  openShared: (link: string, parentFolder: string): Promise<{ projectName: string; projectPath: string }> =>
    window.ipcRenderer.invoke('hub-open-shared', link, parentFolder),
}

/** Subscribes to progress text for one operation key (a project name, or 'open'). */
export function onHubProgress(key: string, cb: (message: string) => void) {
  const listener = (_e: unknown, data: { key: string; message: string }) => { if (data?.key === key) cb(data.message) }
  window.ipcRenderer.on('hub-sync-progress', listener)
  return () => { window.ipcRenderer.off('hub-sync-progress', listener) }
}

export const errorText = (err: unknown) =>
  String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
