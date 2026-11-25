/** Renderer-side calls and events for DAWLab sharing (see electron/sync). Tokens never reach the renderer. */

export type SpaceRole = 'owner' | 'edit' | 'listen'
export type InviteRole = 'edit' | 'listen'

export interface HubSettings { hubUrl: string; hasKey: boolean }
export interface ProjectRemote { hubUrl: string; role: 'edit' | 'listen'; editUrl: string; listenUrl?: string; lastSync?: string }
export interface SyncResult { pushed: number; pulled: number; uploadedFiles: number; downloadedFiles: number; remote: ProjectRemote }

export interface SpaceMember { id: string; name: string; role: SpaceRole; joinedAt: string }
export interface SpaceProject { id: string; name: string; daw: string; addedAt: string; addedBy: string; updatedAt?: string }

/** A shared folder as this Mac knows it. */
export interface SharedFolder {
  folderId: string
  hubUrl: string
  spaceId: string
  memberId: string
  role: SpaceRole
  name: string
  localRoot: string
  projectCount: number
  members: SpaceMember[]
  lastSync?: string
  lastError?: string
}

export interface SpaceDetails {
  space: { id: string; name: string; createdAt: string }
  me: { id: string; name: string; role: SpaceRole }
  members: SpaceMember[]
  projects: SpaceProject[]
  local: SharedFolder
}

/** `code` is there when this Mac created the invite (the hub keeps only a hash). */
export interface InviteInfo { id: string; role: InviteRole; expiresAt: string; maxUses: number; uses: number; code?: string }
export interface CreatedInvite extends Omit<InviteInfo, 'code'> { code: string; link: string }
export interface InvitePreview {
  hubUrl: string
  space: { id: string; name: string }
  role: InviteRole
  invitedBy: string
  projectCount: number
  memberCount: number
  expiresAt: string
  /** You are already in this folder: joining syncs it and doesn't use up the invite. */
  alreadyIn?: { folderId: string; role: InviteRole | 'owner' }
}

export interface SyncNowResult {
  ok: boolean
  pulledVersions?: number
  pushedVersions?: number
  addedProjects?: string[]
  uploadedProjects?: string[]
  failed?: Array<{ project: string; error: string }>
  error?: string
}

/** One line for what a manual sync did: "Up to date", "3 new versions pulled", "1 new project"… */
export function describeSync(r: SyncNowResult): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const parts = [
    r.addedProjects?.length ? `${plural(r.addedProjects.length, 'new project')}` : '',
    r.pulledVersions ? `${plural(r.pulledVersions, 'new version')} pulled` : '',
    r.uploadedProjects?.length ? `${plural(r.uploadedProjects.length, 'project')} shared` : '',
    r.pushedVersions ? `${plural(r.pushedVersions, 'version')} sent` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Up to date'
}

export type SyncState = 'syncing' | 'synced' | 'error'
export interface SyncStatus {
  folderId: string
  state: SyncState
  message?: string
  lastSync?: string
  error?: string
  result?: { pushedVersions: number; pulledVersions: number; addedProjects: string[]; uploadedProjects?: string[]; failed: Array<{ project: string; error: string }> }
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => window.ipcRenderer.invoke(channel, ...args)

export const hub = {
  // server connection
  getSettings: () => invoke<HubSettings>('hub-get-settings'),
  saveSettings: (s: { hubUrl?: string; hubKey?: string }) => invoke<HubSettings>('hub-save-settings', s),
  testConnection: (s: { hubUrl?: string; hubKey?: string }) => invoke<{ ok: boolean; message: string }>('hub-test-connection', s),

  // projects shared one by one, before shared folders
  getRemote: (projectName: string) => invoke<ProjectRemote | null>('hub-get-remote', projectName),
  syncProject: (projectName: string) => invoke<SyncResult>('hub-sync-project', projectName),
  unlinkProject: (projectName: string) => invoke<{ success: boolean }>('hub-unlink-project', projectName),

  // shared folders
  listFolders: () => invoke<SharedFolder[]>('hub-list-spaces'),
  getFolder: (folderId: string) => invoke<SharedFolder | null>('hub-get-space', folderId),
  getProjectFolder: (projectName: string) => invoke<SharedFolder | null>('hub-get-project-space', projectName),
  details: (folderId: string) => invoke<SpaceDetails>('hub-space-details', folderId),
  shareFolder: (folderId: string) => invoke<SharedFolder>('hub-share-folder', folderId),
  syncFolder: (folderId: string) => invoke<SharedFolder | null>('hub-sync-space', folderId),
  syncAll: () => invoke<boolean>('hub-sync-all'),
  syncNow: (folderId: string) => invoke<SyncNowResult>('hub-sync-space-now', folderId),
  /** Pull and push one project of a shared folder. */
  syncProjectNow: (projectName: string) => invoke<{ pulledVersions: number; pushedVersions: number }>('hub-sync-project-now', projectName),
  /** Versions others put on the hub that this Mac doesn't have yet. */
  incomingVersions: (projectName: string) => invoke<number>('hub-project-incoming', projectName),
  previewInvite: (input: string) => invoke<InvitePreview>('hub-preview-invite', input),
  join: (input: string, parentDir: string) =>
    invoke<SharedFolder & { addedProjects: string[]; failed: Array<{ project: string; error: string }> }>('hub-join-space', input, parentDir),
  /** Owner only: the hub's disk size and free space (null on S3). */
  serverStorage: (folderId: string) => invoke<{ kind: string; totalBytes: number | null; freeBytes: number | null }>('hub-server-storage', folderId),
  listInvites: (folderId: string) => invoke<InviteInfo[]>('hub-list-invites', folderId),
  createInvite: (folderId: string, role: InviteRole, days?: number, uses?: number) =>
    invoke<CreatedInvite>('hub-create-invite', folderId, role, days, uses),
  revokeInvite: (folderId: string, inviteId: string) => invoke<boolean>('hub-revoke-invite', folderId, inviteId),
  changeRole: (folderId: string, memberId: string, role: InviteRole) => invoke('hub-change-role', folderId, memberId, role),
  removeMember: (folderId: string, memberId: string) => invoke<boolean>('hub-remove-member', folderId, memberId),
  leave: (folderId: string) => invoke<boolean>('hub-leave-space', folderId),
  stopSharing: (folderId: string) => invoke<boolean>('hub-stop-sharing', folderId),
  takePendingJoin: () => invoke<string | null>('hub-take-pending-join'),
}

// ---------------------------------------------------------------- events
// The preload wraps listeners, so `off` can't remove them. Subscribe to each
// channel once and fan out here instead.

type Listener<T> = (payload: T) => void
const listeners = new Map<string, Set<Listener<any>>>()

function subscribe<T>(channel: string, cb: Listener<T>): () => void {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
    window.ipcRenderer.on(channel, (_e: unknown, payload: T) => {
      for (const l of listeners.get(channel) ?? []) l(payload)
    })
  }
  set.add(cb)
  return () => { set!.delete(cb) }
}

/** Progress text for one operation key: a project name, a folder id, 'open' or 'join'. */
export function onHubProgress(key: string, cb: (message: string) => void) {
  return subscribe<{ key: string; message: string }>('hub-sync-progress', (data) => { if (data?.key === key) cb(data.message) })
}

/** Background sync state of shared folders. */
export const onSyncStatus = (cb: Listener<SyncStatus>) => subscribe<SyncStatus>('hub-status', cb)

/** A dawlab://join link opened while the app was running. */
export const onJoinLink = (cb: Listener<string>) => subscribe<string>('join-shared', cb)

export const errorText = (err: unknown) =>
  String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const roleLabel: Record<SpaceRole, string> = { owner: 'Owner', edit: 'Collaborator', listen: 'Listener' }
export const roleHint: Record<InviteRole, string> = {
  edit: 'Opens projects, saves versions, comments',
  listen: 'Plays previews and comments',
}

/** "2 min ago", "yesterday", or a date. */
export function relativeTime(iso?: string): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(iso).toLocaleDateString()
}
