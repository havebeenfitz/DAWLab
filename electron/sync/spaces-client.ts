/**
 * Shared folders. A Library folder is bound to a "space" on a DAWLab server:
 * every project directly inside the folder is a project of the space, and
 * everyone in the space gets the same folder with the same projects.
 *
 * The binding (server address, space id, this member's token) lives only in
 * the local user dir, never in a project log.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import { getUserDir, getUsername } from '../dawvcs/core/constants'
import { getUserConfigManager } from '../dawvcs/core/config'
import { loadLocalProjectLog } from '../dawvcs/core/log'
import { loadRegistry } from '../dawvcs/core/registry'
import { writeJsonSync } from '../dawvcs/core/fs-utils'
import {
  isInviteCode, normalizeInviteCode, parseJoinLink, toSharedLog,
  type CreatedInvite, type InviteInfo, type InvitePreview, type JoinResponse, type SpaceMember, type SpaceProject,
  type SpaceResponse, type SpaceRole,
} from '../../shared/hub-protocol'
import {
  HubClient, checkOutLatest, createLocalProject, getHubSettings, getProjectRemote, hubError,
  normalizeHubUrl, syncProjectWith, type SyncProgress,
} from './hub-client'

export interface LocalSpace {
  folderId: string
  hubUrl: string
  spaceId: string
  token: string
  memberId: string
  role: SpaceRole
  name: string
  /** Where projects that arrive from other members are put on this Mac. */
  localRoot: string
  /** Hub project id -> local project name. */
  projects: Record<string, string>
  members?: SpaceMember[]
  lastSync?: string
  lastError?: string
}

export interface SpaceSyncResult {
  folderId: string
  pushedVersions: number
  pulledVersions: number
  addedProjects: string[]
  failed: Array<{ project: string; error: string }>
  space: LocalSpace
}

// ------------------------------------------------------------ local state

const spacesFile = () => path.join(getUserDir(), 'spaces.json')

export function listLocalSpaces(): LocalSpace[] {
  return Object.values(readSpaces())
}

export function getLocalSpace(folderId: string): LocalSpace | null {
  return readSpaces()[folderId] ?? null
}

/** The shared folder a project belongs to, if any. */
export function getSpaceForProject(projectName: string): LocalSpace | null {
  const entry = loadRegistry()[projectName]
  if (!entry) return null
  const folderId = folderManager().getProjectFolder(entry.project_id)
  return folderId ? getLocalSpace(folderId) : null
}

function readSpaces(): Record<string, LocalSpace> {
  try {
    return JSON.parse(fs.readFileSync(spacesFile(), 'utf8')) as Record<string, LocalSpace>
  } catch {
    return {}
  }
}

function writeSpace(space: LocalSpace) {
  const all = { ...readSpaces(), [space.folderId]: space }
  fs.mkdirSync(getUserDir(), { recursive: true })
  writeJsonSync(spacesFile(), all)
}

function forgetSpace(folderId: string) {
  const { [folderId]: _gone, ...rest } = readSpaces()
  writeJsonSync(spacesFile(), rest)
}

const folderManager = () => getUserConfigManager(getUsername())

// ------------------------------------------------------------- HTTP

async function call<T>(space: Pick<LocalSpace, 'hubUrl' | 'token'>, p: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${space.hubUrl}/api${p}`, {
    method,
    headers: {
      'X-Hub-Token': space.token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw await hubError(res, 'You no longer have access to this shared folder. Ask its owner to invite you again.')
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const projectClient = (space: LocalSpace, projectId: string) =>
  new HubClient(space.hubUrl, space.token, `/space/projects/${encodeURIComponent(projectId)}`)

const writeRole = (role: SpaceRole) => (role === 'listen' ? 'listen' : 'edit')

// ------------------------------------------------------------- operations

/** Creates a space for a Library folder and uploads every project in it. */
export async function shareFolder(folderId: string, onProgress: SyncProgress = () => {}): Promise<SpaceSyncResult> {
  const existing = getLocalSpace(folderId)
  if (existing) return syncSpace(folderId, onProgress)

  const folder = folderManager().getFolders().find((f) => f.id === folderId)
  if (!folder) throw new Error('This folder no longer exists.')
  const { hubUrl, hubKey } = getHubSettings()
  if (!hubUrl) throw new Error('Connect a DAWLab server first: Settings → DAWLab server.')

  onProgress('Creating the shared folder...')
  const res = await fetch(`${hubUrl}/api/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(hubKey ? { 'X-Hub-Key': hubKey } : {}) },
    body: JSON.stringify({ name: folder.name, memberName: memberName() }),
  })
  if (!res.ok) throw await hubError(res, 'The DAWLab server did not accept the password. Check it in Settings → DAWLab server.')
  const created = (await res.json()) as JoinResponse
  writeSpace({
    folderId,
    hubUrl,
    spaceId: created.space.id,
    token: created.token,
    memberId: created.me.id,
    role: created.me.role,
    name: created.space.name,
    localRoot: defaultRoot(created.space.name),
    projects: {},
  })
  return syncSpace(folderId, onProgress)
}

/**
 * Brings a shared folder up to date in both directions: uploads projects that
 * were added to the folder here, downloads projects others added, and syncs
 * versions and comments of every project.
 */
export async function syncSpace(folderId: string, onProgress: SyncProgress = () => {}): Promise<SpaceSyncResult> {
  const start = getLocalSpace(folderId)
  if (!start) throw new Error('This folder is not shared.')
  let space = start
  try {
    const remote = await call<SpaceResponse>(space, '/space')
    space = { ...space, name: remote.space.name, role: remote.me.role, members: remote.members }

    const result: SpaceSyncResult = { folderId, pushedVersions: 0, pulledVersions: 0, addedProjects: [], failed: [], space }
    space = await uploadNewLocalProjects(space, onProgress, result)
    space = await downloadNewRemoteProjects(space, remote.projects, onProgress, result)

    for (const [projectId, projectName] of Object.entries(space.projects)) {
      if (!loadLocalProjectLog(projectName)) continue
      onProgress(`Syncing ${projectName}...`)
      try {
        const counts = await syncProjectWith(projectName, projectClient(space, projectId), writeRole(space.role), onProgress)
        result.pushedVersions += counts.pushed
        result.pulledVersions += counts.pulled
      } catch (err) {
        result.failed.push({ project: projectName, error: messageOf(err) })
      }
    }

    space = { ...space, lastSync: new Date().toISOString(), lastError: result.failed[0]?.error }
    writeSpace(space)
    return { ...result, space }
  } catch (err) {
    writeSpace({ ...space, lastError: messageOf(err) })
    throw err
  }
}

async function uploadNewLocalProjects(
  space: LocalSpace, onProgress: SyncProgress, result: SpaceSyncResult,
): Promise<LocalSpace> {
  if (space.role === 'listen') return space
  const mapped = new Set(Object.values(space.projects))
  const registry = loadRegistry()
  const folderMap = folderManager().getProjectFolderMap()
  let projects = { ...space.projects }
  for (const [name, entry] of Object.entries<any>(registry)) {
    if (folderMap[entry.project_id] !== space.folderId || mapped.has(name)) continue
    if (getProjectRemote(name)) continue // shared on its own before folders existed; leave it be
    const log = loadLocalProjectLog(name)
    if (!log) continue
    onProgress(`Adding ${name} to the shared folder...`)
    const { project } = await call<{ project: SpaceProject }>(space, '/space/projects', 'POST', { log: toSharedLog(log) })
    projects = { ...projects, [project.id]: name }
    result.addedProjects.push(name)
  }
  const next = { ...space, projects }
  writeSpace(next)
  return next
}

async function downloadNewRemoteProjects(
  space: LocalSpace, remoteProjects: SpaceProject[], onProgress: SyncProgress, result: SpaceSyncResult,
): Promise<LocalSpace> {
  let projects = { ...space.projects }
  for (const project of remoteProjects) {
    if (projects[project.id] && loadLocalProjectLog(projects[project.id])) continue
    onProgress(`Downloading ${project.name}...`)
    try {
      const client = projectClient(space, project.id)
      const { log } = await client.getProject()
      fs.mkdirSync(space.localRoot, { recursive: true })
      const created = createLocalProject(log, space.localRoot)
      folderManager().moveProject(created.projectId, space.folderId)
      projects = { ...projects, [project.id]: created.projectName }
      writeSpace({ ...space, projects })
      await syncProjectWith(created.projectName, client, writeRole(space.role), onProgress)
      await checkOutLatest(created.projectName, created.projectPath, writeRole(space.role), onProgress)
      result.addedProjects.push(created.projectName)
    } catch (err) {
      result.failed.push({ project: project.name, error: messageOf(err) })
    }
  }
  return { ...space, projects }
}

/** Syncs the shared folder a project is in, if it is in one. Used after saving a version. */
export async function syncProjectIfShared(projectName: string, onProgress: SyncProgress = () => {}) {
  const space = getSpaceForProject(projectName)
  return space ? syncSpace(space.folderId, onProgress) : null
}

/** Accepts `DAWL-XXXX-XXXX-XXXX` or a `dawlab://join?...` link. A bare code uses the server from Settings. */
export function parseInvite(input: string): { hubUrl: string; code: string } {
  const text = String(input || '').trim()
  if (text.toLowerCase().startsWith('dawlab://')) {
    const { hubUrl, code } = parseJoinLink(text)
    return { hubUrl: normalizeHubUrl(hubUrl), code }
  }
  if (!isInviteCode(text)) throw new Error('That is not a DAWLab invite. Invites look like DAWL-7KQ4-MX2P-9TRB.')
  const { hubUrl } = getHubSettings()
  if (!hubUrl) throw new Error('This invite needs a DAWLab server. Paste the full dawlab:// link, or connect the server in Settings first.')
  return { hubUrl, code: normalizeInviteCode(text) }
}

/** What an invite opens, before joining. Doesn't use up the invite. */
export async function previewInvite(input: string): Promise<InvitePreview & { hubUrl: string }> {
  const { hubUrl, code } = parseInvite(input)
  const res = await fetch(`${hubUrl}/api/invite/peek`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw await hubError(res, 'This invite is not valid. It may have expired or been used up; ask for a new one.')
  const preview = (await res.json()) as InvitePreview
  if (findJoined(hubUrl, preview.space.id)) throw new Error(`You're already in “${preview.space.name}”. It's in the Shared section of your Library.`)
  return { ...preview, hubUrl }
}

const findJoined = (hubUrl: string, spaceId: string) =>
  listLocalSpaces().find((s) => s.hubUrl === hubUrl && s.spaceId === spaceId) ?? null

/** Joins a shared folder: creates the Library folder and downloads its projects into `parentDir/<folder name>`. */
export async function joinSpace(input: string, parentDir: string, onProgress: SyncProgress = () => {}): Promise<SpaceSyncResult> {
  const { hubUrl, code } = parseInvite(input)
  onProgress('Checking the invite...')
  // Don't spend an invite (or add yourself twice) for a folder you're already in.
  await previewInvite(input)
  const res = await fetch(`${hubUrl}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, memberName: memberName() }),
  })
  if (!res.ok) throw await hubError(res, 'This invite is not valid. It may have expired or been used up; ask for a new one.')
  const joined = (await res.json()) as JoinResponse

  const already = findJoined(hubUrl, joined.space.id)
  if (already) return syncSpace(already.folderId, onProgress)

  const folder = folderManager().createFolder(joined.space.name, null)
  writeSpace({
    folderId: folder.id,
    hubUrl,
    spaceId: joined.space.id,
    token: joined.token,
    memberId: joined.me.id,
    role: joined.me.role,
    name: joined.space.name,
    localRoot: path.join(parentDir, safeFolderName(joined.space.name)),
    projects: {},
  })
  return syncSpace(folder.id, onProgress)
}

// ------------------------------------------------------------- people

export async function getSpaceDetails(folderId: string): Promise<SpaceResponse & { local: LocalSpace }> {
  const space = mustSpace(folderId)
  const details = await call<SpaceResponse>(space, '/space')
  const next = { ...space, name: details.space.name, role: details.me.role, members: details.members }
  writeSpace(next)
  return { ...details, local: next }
}

export const listInvites = (folderId: string) => call<InviteInfo[]>(mustSpace(folderId), '/space/invites')

export async function createInvite(folderId: string, role: 'edit' | 'listen', expiresInDays = 7, maxUses = 10) {
  const space = mustSpace(folderId)
  const invite = await call<CreatedInvite>(space, '/space/invites', 'POST', { role, expiresInDays, maxUses })
  const link = `dawlab://join?hub=${encodeURIComponent(space.hubUrl)}&code=${encodeURIComponent(invite.code)}`
  return { ...invite, link }
}

export const revokeInvite = (folderId: string, inviteId: string) =>
  call<void>(mustSpace(folderId), `/space/invites/${encodeURIComponent(inviteId)}`, 'DELETE')

export const changeMemberRole = (folderId: string, memberId: string, role: 'edit' | 'listen') =>
  call<{ member: SpaceMember }>(mustSpace(folderId), `/space/members/${encodeURIComponent(memberId)}`, 'PATCH', { role })

export const removeMember = (folderId: string, memberId: string) =>
  call<void>(mustSpace(folderId), `/space/members/${encodeURIComponent(memberId)}`, 'DELETE')

/** Leaves a folder someone else shared. Local copies of the projects stay. */
export async function leaveSpace(folderId: string) {
  const space = mustSpace(folderId)
  if (space.role === 'owner') throw new Error('You own this folder. Use "Stop sharing" instead.')
  await call<void>(space, `/space/members/${encodeURIComponent(space.memberId)}`, 'DELETE').catch(() => undefined)
  forgetSpace(folderId)
}

/** Owner only: removes everyone's access. Local copies of the projects stay. */
export async function stopSharing(folderId: string) {
  const space = mustSpace(folderId)
  if (space.role !== 'owner') throw new Error('Only the owner can stop sharing this folder.')
  await call<void>(space, '/space', 'DELETE')
  forgetSpace(folderId)
}

// ------------------------------------------------------------- helpers

function mustSpace(folderId: string): LocalSpace {
  const space = getLocalSpace(folderId)
  if (!space) throw new Error('This folder is not shared.')
  return space
}

function memberName(): string {
  try {
    return getUsername() || os.userInfo().username || 'DAWLab user'
  } catch {
    return 'DAWLab user'
  }
}

function defaultRoot(spaceName: string) {
  return path.join(os.homedir(), 'Music', 'DAWLab', safeFolderName(spaceName))
}

function safeFolderName(name: string) {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').replace(/^[.\s]+/, '').trim().slice(0, 80)
  return cleaned || 'Shared folder'
}

const messageOf = (err: unknown) =>
  String((err as Error)?.message ?? err)
