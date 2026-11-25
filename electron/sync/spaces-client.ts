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
import { getProjectStorageDirs } from '../dawvcs/core/storage-location'
import { commitExists } from '../dawvcs/core/commits'
import { writeJsonSync } from '../dawvcs/core/fs-utils'
import {
  allCommits, parseFullInvite, buildFullInvite, parseJoinLink, toSharedLog,
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
  /** Projects that arrived from other people. */
  addedProjects: string[]
  /** Projects of yours that were shared for the first time. */
  uploadedProjects: string[]
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
  writeInviteCodes(folderId, {})
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

    const result: SpaceSyncResult = { folderId, pushedVersions: 0, pulledVersions: 0, addedProjects: [], uploadedProjects: [], failed: [], space }
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
    result.uploadedProjects.push(name)
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

// ------------------------------------------------------------- one project

/** The shared folder and hub project id behind a local project, if it is in a shared folder. */
export function findSharedProject(projectName: string): { space: LocalSpace; projectId: string } | null {
  const space = getSpaceForProject(projectName)
  if (!space) return null
  const projectId = Object.entries(space.projects).find(([, name]) => name === projectName)?.[0]
  return projectId ? { space, projectId } : null
}

export interface ProjectSyncResult {
  pulledVersions: number
  pushedVersions: number
}

/**
 * Pulls one project's new versions, alternatives and comments from the hub and
 * sends this Mac's new ones. A project not yet uploaded to its shared folder
 * goes through a folder sync, which uploads it first.
 */
export async function syncSharedProject(projectName: string, onProgress: SyncProgress = () => {}): Promise<ProjectSyncResult> {
  const found = findSharedProject(projectName)
  if (!found) {
    const space = getSpaceForProject(projectName)
    if (!space) throw new Error(`'${projectName}' is not in a shared folder.`)
    const r = await syncSpace(space.folderId, onProgress)
    return { pulledVersions: r.pulledVersions, pushedVersions: r.pushedVersions }
  }
  const counts = await syncProjectWith(projectName, projectClient(found.space, found.projectId), writeRole(found.space.role), onProgress)
  return { pulledVersions: counts.pulled, pushedVersions: counts.pushed }
}

/** How many versions others put on the hub that this Mac doesn't have yet. Reads only the version list. */
export async function countIncomingVersions(projectName: string): Promise<number> {
  const found = findSharedProject(projectName)
  if (!found) return 0
  const { log } = await projectClient(found.space, found.projectId).getProject()
  const { commitsDir } = getProjectStorageDirs(projectName)
  return allCommits(log).filter((c) => !commitExists(projectName, c.commit_id, commitsDir)).length
}

/** Syncs the shared folder a project is in, if it is in one. Used after saving a version. */
export async function syncProjectIfShared(projectName: string, onProgress: SyncProgress = () => {}) {
  const space = getSpaceForProject(projectName)
  return space ? syncSpace(space.folderId, onProgress) : null
}

/**
 * Accepts the full invite (code + server, what Share produces), a
 * `dawlab://join?...` link, or a bare `DAWL-XXXX-XXXX-XXXX`, which uses the
 * server from Settings.
 */
export function parseInvite(input: string): { hubUrl: string; code: string } {
  const text = String(input || '').trim()
  if (text.toLowerCase().startsWith('dawlab://')) {
    const { hubUrl, code } = parseJoinLink(text)
    return { hubUrl: normalizeHubUrl(hubUrl), code }
  }
  const parsed = parseFullInvite(text)
  if (!parsed) throw new Error('That is not a DAWLab invite. Copy the whole invite code you were sent, starting with DAWL-.')
  if (parsed.hubUrl) return { hubUrl: normalizeHubUrl(parsed.hubUrl), code: parsed.code }
  const { hubUrl } = getHubSettings()
  if (!hubUrl) throw new Error('This invite code is incomplete. Ask for the invite again and copy the whole code.')
  return { hubUrl, code: parsed.code }
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
  const joined = findJoined(hubUrl, preview.space.id)
  if (joined && (await stillMember(joined))) {
    throw new Error(`You're already in “${preview.space.name}”. It's in the Shared section of your Library.`)
  }
  return { ...preview, hubUrl }
}

/**
 * False when the hub no longer knows this Mac's token: the owner removed you.
 * A network error is not proof of that, so it counts as still a member.
 */
async function stillMember(space: LocalSpace): Promise<boolean> {
  try {
    const res = await fetch(`${space.hubUrl}/api/space`, { headers: { 'X-Hub-Token': space.token } })
    return res.status !== 404
  } catch {
    return true
  }
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

  // Invited again after being removed: keep the folder and the local copies,
  // take the new access, and sync so everything missed since comes down.
  const already = findJoined(hubUrl, joined.space.id)
  if (already) {
    writeSpace({ ...already, token: joined.token, memberId: joined.me.id, role: joined.me.role, name: joined.space.name, lastError: undefined })
    return syncSpace(already.folderId, onProgress)
  }

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

// The hub keeps only a hash of each invite code, so the owner's Mac remembers
// the codes it created (in their own file, so a sync writing spaces.json can't drop them).
const inviteCodesFile = () => path.join(getUserDir(), 'invite-codes.json')

function readInviteCodes(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(fs.readFileSync(inviteCodesFile(), 'utf8')) as Record<string, Record<string, string>>
  } catch {
    return {}
  }
}

function writeInviteCodes(folderId: string, codes: Record<string, string>) {
  const all = readInviteCodes()
  if (Object.keys(codes).length) all[folderId] = codes
  else delete all[folderId]
  fs.mkdirSync(getUserDir(), { recursive: true })
  writeJsonSync(inviteCodesFile(), all)
}

/** Open invites, each with its full code when this Mac created it. Codes of invites that are gone are forgotten. */
export async function listInvites(folderId: string): Promise<Array<InviteInfo & { code?: string }>> {
  const invites = await call<InviteInfo[]>(mustSpace(folderId), '/space/invites')
  const known = readInviteCodes()[folderId] ?? {}
  const kept: Record<string, string> = {}
  for (const inv of invites) if (known[inv.id]) kept[inv.id] = known[inv.id]
  if (Object.keys(kept).length !== Object.keys(known).length) writeInviteCodes(folderId, kept)
  return invites.map((inv) => (kept[inv.id] ? { ...inv, code: kept[inv.id] } : inv))
}

export interface ServerStorage { kind: string; totalBytes: number | null; freeBytes: number | null }

/** How full the hub's disk is. Only the folder's owner may ask. */
export const getServerStorage = (folderId: string) => call<ServerStorage>(mustSpace(folderId), '/space/storage')

export async function createInvite(folderId: string, role: 'edit' | 'listen', expiresInDays = 7, maxUses = 10) {
  const space = mustSpace(folderId)
  const invite = await call<CreatedInvite>(space, '/space/invites', 'POST', { role, expiresInDays, maxUses })
  const link = `dawlab://join?hub=${encodeURIComponent(space.hubUrl)}&code=${encodeURIComponent(invite.code)}`
  // The code people send carries the server address, so joiners set up nothing.
  const code = buildFullInvite(space.hubUrl, invite.code)
  writeInviteCodes(folderId, { ...(readInviteCodes()[folderId] ?? {}), [invite.id]: code })
  return { ...invite, code, link }
}

export async function revokeInvite(folderId: string, inviteId: string) {
  await call<void>(mustSpace(folderId), `/space/invites/${encodeURIComponent(inviteId)}`, 'DELETE')
  const { [inviteId]: _gone, ...rest } = readInviteCodes()[folderId] ?? {}
  writeInviteCodes(folderId, rest)
}

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
