/**
 * Desktop side of DAWLab Hub sharing: share a local project to a hub, sync it
 * (push local versions, pull everyone else's), and open a project someone
 * shared with you. Local storage is unchanged: pulled versions land in the
 * same CAS + commits dirs a local commit would use, so history, rollback and
 * previews work exactly as for local versions.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { getUserDir } from '../dawvcs/core/constants'
import { loadLocalProjectLog, saveProjectLog, buildProjectLog } from '../dawvcs/core/log'
import { loadRegistry, registerProject } from '../dawvcs/core/registry'
import { getProjectStorageDirs } from '../dawvcs/core/storage-location'
import { commitExists, getCommitFileMap, getCommitPath, saveCommit } from '../dawvcs/core/commits'
import { ensureCasDir, getCasPath } from '../dawvcs/core/cas'
import { writeJsonSync } from '../dawvcs/core/fs-utils'
import { rollbackProject } from '../dawvcs/operations/rollback'
import { parseCommentsFile, serializeComments } from '../feedback/comments-file'
import {
  allCommits, isCommitId, isHash, mergeComments, mergeLogs, parseShareLink, toSharedLog,
  type CreateProjectResponse, type HubRole, type ProjectResponse, type SharedComment, type SharedLog,
} from '../../shared/hub-protocol'
import { adoptHubPlacement } from '../../shared/forks'

export interface HubSettings {
  hubUrl: string
  hubKey: string
}

export interface ProjectRemote {
  hubUrl: string
  /** The link's token: an edit token lets this machine push and pull, a listen token only fetches previews and comments. */
  token: string
  /** Missing on remotes saved before listen links opened in the app: those are edit links. */
  role?: HubRole
  editUrl: string
  listenUrl?: string
  lastSync?: string
}

export interface SyncResult {
  pushed: number
  pulled: number
  uploadedFiles: number
  downloadedFiles: number
  remote: ProjectRemote
}

export type SyncProgress = (message: string) => void

// ------------------------------------------------------------ local config

const settingsFile = () => path.join(getUserDir(), 'hub.json')
const remotesFile = () => path.join(getUserDir(), 'remotes.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function getHubSettings(): HubSettings {
  return { hubUrl: '', hubKey: '', ...readJson<Partial<HubSettings>>(settingsFile(), {}) }
}

export function saveHubSettings(settings: Partial<HubSettings>): HubSettings {
  const next = { ...getHubSettings(), ...settings }
  next.hubUrl = normalizeHubUrl(next.hubUrl)
  fs.mkdirSync(getUserDir(), { recursive: true })
  writeJsonSync(settingsFile(), next)
  return next
}

/** Remotes hold tokens, so they live in the local user dir, never in the shared log. */
export function getProjectRemote(projectName: string): ProjectRemote | null {
  return readJson<Record<string, ProjectRemote>>(remotesFile(), {})[projectName] ?? null
}

function saveProjectRemote(projectName: string, remote: ProjectRemote) {
  const all = readJson<Record<string, ProjectRemote>>(remotesFile(), {})
  all[projectName] = remote
  fs.mkdirSync(getUserDir(), { recursive: true })
  writeJsonSync(remotesFile(), all)
}

export { saveProjectRemote }

export function removeProjectRemote(projectName: string) {
  const all = readJson<Record<string, ProjectRemote>>(remotesFile(), {})
  delete all[projectName]
  writeJsonSync(remotesFile(), all)
}

export function normalizeHubUrl(url: string) {
  const trimmed = (url || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const parsed = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`)
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

// ------------------------------------------------------------- HTTP client

/**
 * Talks to one project on a hub. `base` is `/project` for a legacy project
 * link, or `/space/projects/<id>` for a project in a shared folder.
 */
export class HubClient {
  readonly hubUrl: string
  readonly token: string
  readonly base: string
  constructor(hubUrl: string, token: string, base = '/project') {
    this.hubUrl = hubUrl
    this.token = token
    this.base = base
  }

  private async request(p: string, init: RequestInit & { duplex?: 'half' } = {}): Promise<Response> {
    const res = await fetch(`${this.hubUrl}/api${p}`, {
      ...init,
      headers: { 'X-Hub-Token': this.token, ...(init.headers as Record<string, string>) },
    })
    if (!res.ok) throw await hubError(res, 'You no longer have access to this on the DAWLab server. Ask the owner to invite you again.')
    return res
  }

  private async json<T>(p: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await this.request(p, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
    })
    return (await res.json()) as T
  }

  getProject = () => this.json<ProjectResponse>(this.base)
  putLog = (log: SharedLog) => this.json<ProjectResponse>(`${this.base}/log`, 'PUT', log)
  missing = (hashes: string[]) => this.json<{ missing: string[] }>(`${this.base}/objects/missing`, 'POST', { hashes })
  putFilemap = (commitId: string, filemap: unknown) => this.json(`${this.base}/commits/${commitId}/filemap`, 'PUT', filemap)
  getFilemap = (commitId: string) => this.json<Array<{ path: string; hash: string }>>(`${this.base}/commits/${commitId}/filemap`)
  getComments = (commitId: string) => this.json<SharedComment[]>(`${this.base}/commits/${commitId}/comments`)
  postComments = (commitId: string, comments: SharedComment[]) =>
    this.json<SharedComment[]>(`${this.base}/commits/${commitId}/comments`, 'POST', comments)

  async uploadObject(hash: string, file: string) {
    const size = fs.statSync(file).size
    await this.request(`${this.base}/objects/${hash}`, {
      method: 'PUT',
      body: Readable.toWeb(fs.createReadStream(file)) as any,
      duplex: 'half',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    })
  }

  /** Downloads to a temp file, checks the hash, then moves it into CAS. */
  async downloadObject(hash: string, target: string) {
    const res = await this.request(`${this.base}/objects/${hash}`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.download`
    const hasher = crypto.createHash('sha256')
    try {
      await pipeline(
        Readable.fromWeb(res.body as any),
        async function* (source) {
          for await (const chunk of source) {
            hasher.update(chunk)
            yield chunk
          }
        },
        fs.createWriteStream(tmp),
      )
      if (hasher.digest('hex') !== hash) throw new Error(`Downloaded file does not match ${hash}`)
      fs.renameSync(tmp, target)
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  }
}

// ------------------------------------------------------------- operations

/** Creates the project on the configured hub (first share) and pushes everything. */
export async function shareProject(projectName: string, onProgress: SyncProgress = () => {}): Promise<SyncResult> {
  const existing = getProjectRemote(projectName)
  if (existing) return syncProject(projectName, onProgress)

  const { hubUrl, hubKey } = getHubSettings()
  if (!hubUrl) throw new Error('Connect a DAWLab server first: Settings → DAWLab server.')
  const log = loadLocalProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not found`)

  onProgress('Creating the project on the hub...')
  const res = await fetch(`${hubUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(hubKey ? { 'X-Hub-Key': hubKey } : {}) },
    body: JSON.stringify({ log: toSharedLog(log) }),
  })
  if (!res.ok) throw await hubError(res, 'The DAWLab server did not accept the password. Check it in Settings → DAWLab server.')
  const created = (await res.json()) as CreateProjectResponse
  saveProjectRemote(projectName, {
    hubUrl, token: created.editToken, role: 'edit', editUrl: created.editUrl, listenUrl: created.listenUrl,
  })
  return syncProject(projectName, onProgress)
}

/** Pushes local versions the hub lacks, then pulls versions and comments others added. */
export async function syncProject(projectName: string, onProgress: SyncProgress = () => {}): Promise<SyncResult> {
  const remote = getProjectRemote(projectName)
  if (!remote) throw new Error(`'${projectName}' is not shared yet.`)
  const client = new HubClient(remote.hubUrl, remote.token)
  const counts = await syncProjectWith(projectName, client, remote.role ?? 'edit', onProgress)
  const next = { ...remote, lastSync: new Date().toISOString() }
  saveProjectRemote(projectName, next)
  return { ...counts, remote: next }
}

export interface SyncCounts {
  pushed: number
  pulled: number
  uploadedFiles: number
  downloadedFiles: number
}

/**
 * One sync of a local project against one hub project, through `client`.
 * An `edit` role pushes local versions and pulls everyone else's; a `listen`
 * role pulls the version list, previews and comments only.
 */
export async function syncProjectWith(
  projectName: string,
  client: HubClient,
  role: HubRole,
  onProgress: SyncProgress = () => {},
): Promise<SyncCounts> {
  const { casDir, commitsDir } = getProjectStorageDirs(projectName)
  const local = loadLocalProjectLog(projectName)
  if (!local) throw new Error(`Project '${projectName}' not found`)

  if (role === 'listen') {
    const { log: remoteLog } = await client.getProject()
    const pulled = await pullInto(projectName, client, remoteLog, onProgress, { previewsOnly: true })
    onProgress('Syncing comments...')
    for (const c of allCommits(remoteLog)) await syncComments(projectName, c.commit_id, client, commitsDir)
    return { pushed: 0, pulled: pulled.versions, uploadedFiles: 0, downloadedFiles: pulled.files }
  }

  // ---- push
  const before = await client.getProject()
  const remoteIds = new Set(allCommits(before.log).map((c) => c.commit_id))
  const toPush = allCommits(local).filter(
    (c) => !remoteIds.has(String(c.commit_id)) && commitExists(projectName, String(c.commit_id), commitsDir),
  )

  const blobFiles = new Map<string, string>()
  const filemaps = new Map<string, unknown>()
  for (const c of toPush) {
    const id = String(c.commit_id)
    const filemap = getCommitFileMap(projectName, id, commitsDir)
    filemaps.set(id, filemap)
    for (const e of filemap) if (e.hash !== 'empty') blobFiles.set(e.hash, getCasPath(e.hash, casDir))
  }
  // Previews may be new on versions the hub already has (attached later).
  for (const c of allCommits(local)) {
    if (!c.preview_file) continue
    const inCas = getCasPath(c.preview_file, casDir)
    const inCommit = path.join(getCommitPath(projectName, String(c.commit_id), commitsDir), c.preview_file)
    const file = fs.existsSync(inCas) ? inCas : inCommit
    if (fs.existsSync(file)) blobFiles.set(c.preview_file, file)
  }

  const { missing } = blobFiles.size ? await client.missing([...blobFiles.keys()]) : { missing: [] }
  let uploaded = 0
  for (const hash of missing) {
    uploaded++
    onProgress(`Uploading file ${uploaded} of ${missing.length}...`)
    const file = blobFiles.get(hash)!
    if (!fs.existsSync(file)) {
      throw new Error(`A file from one of the versions of '${projectName}' is missing on this Mac, so that version can't be shared. Open the project once so DAWLab can find it, then sync again.`)
    }
    await client.uploadObject(hash, file)
  }
  for (const [id, filemap] of filemaps) await client.putFilemap(id, filemap)

  // Versions whose preview is missing locally can't be pushed with it; drop the pointer for the hub only.
  const shared = toSharedLog(local)
  for (const b of shared.branches) {
    b.commits = b.commits.filter((c) => remoteIds.has(c.commit_id) || filemaps.has(c.commit_id))
    for (const c of b.commits) if (c.preview_file && !blobFiles.has(c.preview_file)) delete c.preview_file
  }
  onProgress('Updating version history...')
  const after = await client.putLog(shared)

  // ---- pull
  const pulled = await pullInto(projectName, client, after.log, onProgress)

  // ---- comments, both ways
  onProgress('Syncing comments...')
  for (const c of allCommits(after.log)) await syncComments(projectName, c.commit_id, client, commitsDir)

  return { pushed: toPush.length, pulled: pulled.versions, uploadedFiles: missing.length, downloadedFiles: pulled.files }
}

/**
 * Opens a project from a collaborator link: registers it locally under
 * `parentFolder/<name>`, downloads every version, and checks out the latest
 * one on main so the DAW project is ready to open.
 */
export async function openSharedProject(
  link: string,
  parentFolder: string,
  onProgress: SyncProgress = () => {},
): Promise<{ projectName: string; projectPath: string }> {
  const { hubUrl, token } = parseShareLink(link)
  const client = new HubClient(hubUrl, token)
  onProgress('Reading the shared project...')
  const { role, log: remoteLog } = await client.getProject()
  assertSafeLog(remoteLog)
  const registry = loadRegistry()
  const already = Object.entries(registry).find(([name]) => getProjectRemote(name)?.token === token)
  if (already) {
    await syncProject(already[0], onProgress)
    return { projectName: already[0], projectPath: (already[1] as any).path }
  }

  const created = createLocalProject(remoteLog, parentFolder)
  saveProjectRemote(created.projectName, role === 'edit'
    ? { hubUrl, token, role, editUrl: link.trim() }
    : { hubUrl, token, role, editUrl: '', listenUrl: link.trim() })

  await syncProject(created.projectName, onProgress)
  await checkOutLatest(created.projectName, created.projectPath, role, onProgress)
  return created
}

/** Registers an empty local project for a hub project, in `parentFolder/<name>`. */
export function createLocalProject(remoteLog: SharedLog, parentFolder: string): { projectName: string; projectPath: string; projectId: string } {
  assertSafeLog(remoteLog)
  const registry = loadRegistry()
  let projectName = safeName(remoteLog.name || 'Shared project')
  for (let i = 2; registry[projectName]; i++) projectName = `${safeName(remoteLog.name)} (${i})`
  const projectPath = path.join(parentFolder, projectName)
  if (fs.existsSync(projectPath) && fs.readdirSync(projectPath).length > 0) {
    throw new Error(`${projectPath} already exists and is not empty. Pick another folder.`)
  }

  const projectId = isCommitId(remoteLog.id) ? remoteLog.id : crypto.randomUUID()
  registerProject(projectId, projectName, projectPath, remoteLog.daw, undefined, remoteLog.description ?? undefined,
    remoteLog.key ?? undefined, remoteLog.bpm ?? undefined, 'shared', undefined, 'home')
  const base = buildProjectLog(projectName, projectPath, { projectID: projectId, daw: remoteLog.daw, privacy_flag: 'shared' })
  base.branches = []
  saveProjectLog(projectName, base)
  return { projectName, projectPath, projectId }
}

/** After a first download: collaborators get the newest version on main in the project folder. */
export async function checkOutLatest(projectName: string, projectPath: string, role: HubRole, onProgress: SyncProgress = () => {}) {
  const log = loadLocalProjectLog(projectName)
  const main = log.branches.find((b: any) => b.name === 'main') ?? log.branches[0]
  const latest = main?.commits?.[main.commits.length - 1]
  if (latest && role === 'edit') {
    onProgress('Restoring the latest version...')
    log.current_branch = main.name
    saveProjectLog(projectName, log)
    await rollbackProject(projectName, String(latest.commit_id))
  } else {
    fs.mkdirSync(projectPath, { recursive: true })
  }
}

// ---------------------------------------------------------------- helpers

async function pullInto(
  projectName: string,
  client: HubClient,
  remoteLog: SharedLog,
  onProgress: SyncProgress,
  opts: { previewsOnly?: boolean } = {},
) {
  assertSafeLog(remoteLog)
  const { casDir, commitsDir } = getProjectStorageDirs(projectName)
  ensureCasDir(casDir)
  const isNew = (id: string) => !commitExists(projectName, id, commitsDir)
  // Versions kept from a time as a listener have no files. Someone who can now
  // edit gets them filled in, so any of those versions can be opened.
  const isHollow = (id: string) => {
    if (opts.previewsOnly || isNew(id)) return false
    try {
      return getCommitFileMap(projectName, id, commitsDir).length === 0
    } catch {
      return false
    }
  }
  const newCommits = allCommits(remoteLog).filter((c) => isNew(c.commit_id) || isHollow(c.commit_id))
  const reallyNew = newCommits.filter((c) => isNew(c.commit_id)).length

  const need = new Set<string>()
  const filemaps = new Map<string, Array<{ path: string; hash: string }>>()
  for (const c of newCommits) {
    // A listen link can't read filemaps: its versions are kept with no files, just previews and comments.
    const filemap = opts.previewsOnly ? [] : await client.getFilemap(c.commit_id)
    assertSafeFilemap(filemap)
    filemaps.set(c.commit_id, filemap)
    for (const e of filemap) if (e.hash !== 'empty' && !fs.existsSync(getCasPath(e.hash, casDir))) need.add(e.hash)
  }
  for (const c of allCommits(remoteLog)) {
    if (c.preview_file && !fs.existsSync(getCasPath(c.preview_file, casDir))) need.add(c.preview_file)
  }

  let n = 0
  for (const hash of need) {
    n++
    onProgress(`Downloading file ${n} of ${need.size}...`)
    await client.downloadObject(hash, getCasPath(hash, casDir))
  }
  // Filemaps last: a version only appears locally once all its files are here.
  for (const [id, filemap] of filemaps) saveCommit(projectName, id, filemap, commitsDir)

  // Versions the hub moved into a parallel alternative leave the one they were saved on here too.
  const local = adoptHubPlacement(loadLocalProjectLog(projectName), remoteLog)
  saveProjectLog(projectName, mergeLogs(local, remoteLog))
  return { versions: reallyNew, files: need.size }
}

async function syncComments(projectName: string, commitId: string, client: HubClient, commitsDir: string) {
  const dir = getCommitPath(projectName, commitId, commitsDir)
  if (!fs.existsSync(dir)) return
  const file = path.join(dir, 'comments.json')
  let local: SharedComment[] = []
  if (fs.existsSync(file)) {
    try {
      local = parseCommentsFile(fs.readFileSync(file, 'utf8')) as SharedComment[]
    } catch {
      return // never overwrite a comments file we can't read
    }
  }
  const merged = local.length ? await client.postComments(commitId, local) : await client.getComments(commitId)
  const result = mergeComments(local, merged)
  if (JSON.stringify(result) !== JSON.stringify(local)) writeJsonSync(file, serializeComments(result))
}

/** A hub answers an unknown key or token with an empty 404 and nothing else, so say what that usually means. */
export async function hubError(res: Response, hiddenMessage: string): Promise<Error> {
  const body: any = await res.json().catch(() => null)
  if (res.status === 404 && !body) return new Error(hiddenMessage)
  return new Error(body?.error || `The DAWLab server answered ${res.status} ${res.statusText}.`)
}

function safeName(name: string) {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').replace(/^[.\s]+/, '').trim().slice(0, 80)
  return cleaned || 'Shared project'
}

/**
 * A hub (or anyone holding an edit link) controls the log and filemaps we
 * download. Ids and hashes become local paths, so reject anything that isn't
 * exactly the shape DAWLab writes itself.
 */
function assertSafeLog(log: SharedLog) {
  for (const c of allCommits(log)) {
    if (!isCommitId(c.commit_id)) throw new Error('The hub sent an invalid version id; refusing to sync.')
    if (c.preview_file !== undefined && !isHash(c.preview_file)) throw new Error('The hub sent an invalid preview; refusing to sync.')
  }
}

function assertSafeFilemap(filemap: Array<{ path: string; hash: string }>) {
  if (!Array.isArray(filemap)) throw new Error('The hub sent an invalid file list; refusing to sync.')
  for (const e of filemap) {
    const p = typeof e?.path === 'string' ? e.path : ''
    const unsafe = !p || path.isAbsolute(p) || path.win32.isAbsolute(p) || p.split(/[\\/]/).includes('..')
    if (unsafe || (e.hash !== 'empty' && !isHash(e.hash))) {
      throw new Error(`The hub sent an unsafe file path (${p}); refusing to sync.`)
    }
  }
}
