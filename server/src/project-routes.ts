/**
 * The per-project API: version history, files, filemaps and previews.
 * Served both at /api/project/... (legacy project token) and at
 * /api/space/projects/:projectId/... (space member token). The caller passes
 * an `authorize(need)` that resolves who may touch which project.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Storage } from './storage.ts'
import { resolveRange } from '../../electron/media/range.ts'
import {
  allCommits, isCommitId, isHash, mergeLogs, toSharedLog,
  type HubRole, type SharedLog,
} from '../../shared/hub-protocol.ts'
import { placeIncoming } from '../../shared/forks.ts'
import { HIDDEN, HttpError, nowIso, readJson, send, withLock } from './http-util.ts'
import { keys, type ProjectMeta } from './keys.ts'

/** What other members need to hear about: which versions exist, with which previews, in which alternatives. */
function versionsKey(log: { branches?: any[] }): string {
  const parts: string[] = []
  for (const b of log.branches ?? []) {
    for (const c of b.commits ?? []) parts.push(`${b.name}|${c.commit_id}|${c.preview_file ?? ''}`)
    for (const d of b.dismissed ?? []) parts.push(`${b.name}|dismissed|${JSON.stringify(d)}`)
  }
  return parts.sort().join('\n')
}

/** Responses of PUT log that changed nothing: no change event goes out for them. */
export const unchangedLogWrites = new WeakSet<http.ServerResponse>()

export interface ProjectAccess {
  projectId: string
  /** What the caller may do with the project: `edit` reads and writes, `listen` gets previews. */
  role: HubRole
}

/** Resolves access for one request; throws HIDDEN or a 403 when `need` isn't met. */
export type Authorize = (need: HubRole) => Promise<ProjectAccess>

const MAX_HASHES_PER_QUERY = 20000

export function createProjectRoutes(storage: Storage, maxUpload: number) {
  async function loadLog(projectId: string): Promise<SharedLog> {
    const log = await storage.getJson<SharedLog>(keys.log(projectId))
    if (!log) throw new HttpError(404, 'Project not found')
    return log
  }

  async function putLog(access: ProjectAccess, req: http.IncomingMessage, res: http.ServerResponse) {
    const incoming = parseLog(await readJson(req))
    const merged = await withLock(keys.log(access.projectId), async () => {
      const current = await loadLog(access.projectId)
      // Only accept versions whose filemap was uploaded first, so the log never points at missing data.
      for (const c of allCommits(incoming)) {
        if (!isCommitId(c.commit_id)) throw new HttpError(400, 'Bad version id')
        if (c.preview_file !== undefined && !isHash(c.preview_file)) throw new HttpError(400, `Bad preview for ${c.commit_id}`)
        if (!(await storage.exists(keys.filemap(access.projectId, c.commit_id)))) {
          throw new HttpError(409, `Upload the filemap of version ${c.commit_id} before the log`)
        }
      }
      // Two people saving on top of the same version: the later one goes into its own alternative.
      const next = mergeLogs(current, placeIncoming(current, { ...incoming, id: current.id, name: current.name }))
      // Every sync sends its log, most of the time with no new versions. Only new versions,
      // previews, alternatives or dismissals count as a change: details like metadata, bpm or
      // commit order differ per Mac, and announcing them made apps wake each other up forever.
      if (versionsKey(next) === versionsKey(current)) {
        unchangedLogWrites.add(res)
        if (JSON.stringify(next) !== JSON.stringify(current)) await storage.putJson(keys.log(access.projectId), next)
        return next
      }
      await storage.putJson(keys.log(access.projectId), next)
      const meta = await storage.getJson<ProjectMeta>(keys.meta(access.projectId))
      if (meta) await storage.putJson(keys.meta(access.projectId), { ...meta, updatedAt: nowIso() })
      return next
    })
    send(res, 200, { role: access.role, log: merged })
  }

  async function missingObjects(access: ProjectAccess, req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readJson(req)
    if (Array.isArray(body?.hashes) && body.hashes.length > MAX_HASHES_PER_QUERY) throw new HttpError(413, 'Ask about fewer files at once')
    const hashes: string[] = Array.isArray(body?.hashes) ? body.hashes.filter(isHash) : []
    const missing: string[] = []
    for (const h of new Set(hashes)) if (!(await storage.exists(keys.object(access.projectId, h)))) missing.push(h)
    send(res, 200, { missing })
  }

  /** Sizes of stored files, so a download can show how much is left. Unknown hashes are null. */
  async function objectSizes(access: ProjectAccess, req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readJson(req)
    if (Array.isArray(body?.hashes) && body.hashes.length > MAX_HASHES_PER_QUERY) throw new HttpError(413, 'Ask about fewer files at once')
    const hashes: string[] = Array.isArray(body?.hashes) ? body.hashes.filter(isHash) : []
    const sizes: Record<string, number | null> = {}
    for (const h of new Set(hashes)) sizes[h] = await storage.size(keys.object(access.projectId, h))
    send(res, 200, { sizes })
  }

  async function putObject(access: ProjectAccess, hash: string, req: http.IncomingMessage, res: http.ServerResponse) {
    if (await storage.exists(keys.object(access.projectId, hash))) {
      req.resume()
      return send(res, 200, { hash, existed: true })
    }
    const tmp = path.join(os.tmpdir(), `dawlab-hub-${crypto.randomUUID()}`)
    const hasher = crypto.createHash('sha256')
    let size = 0
    try {
      await pipeline(req, async function* (source) {
        for await (const chunk of source) {
          size += chunk.length
          if (size > maxUpload) throw new HttpError(413, 'File too large for this hub')
          hasher.update(chunk)
          yield chunk
        }
      }, fs.createWriteStream(tmp))
      if (hasher.digest('hex') !== hash) throw new HttpError(400, 'Content does not match its hash')
      await storage.putFile(keys.object(access.projectId, hash), tmp, size)
    } finally {
      await fs.promises.rm(tmp, { force: true })
    }
    send(res, 201, { hash })
  }

  async function getObject(access: ProjectAccess, hash: string, req: http.IncomingMessage, res: http.ServerResponse) {
    if (access.role === 'listen') {
      // Listeners can stream previews, never the project files themselves.
      const previews = new Set(allCommits(await loadLog(access.projectId)).map((c) => c.preview_file))
      if (!previews.has(hash)) throw new HttpError(403, 'This link can only play previews')
    }
    const key = keys.object(access.projectId, hash)
    const size = await storage.size(key)
    if (size === null) throw new HttpError(404, 'No such object')
    const range = resolveRange(req.headers.range, size)
    if (range.kind === 'unsatisfiable') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      return res.end()
    }
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': await sniffType(storage, key, size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': size === 0 ? 0 : range.end - range.start + 1,
    }
    if (range.kind === 'partial') headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    res.writeHead(range.kind === 'partial' ? 206 : 200, headers)
    if (req.method === 'HEAD' || size === 0) return res.end()
    const body = await storage.stream(key, { start: range.start, end: range.end })
    if (!body) return res.end()
    await pipeline(body, res)
  }

  async function putFilemap(access: ProjectAccess, commitId: string, req: http.IncomingMessage, res: http.ServerResponse) {
    const filemap = await readJson(req)
    if (!Array.isArray(filemap)) throw new HttpError(400, 'filemap must be an array')
    for (const entry of filemap) {
      if (typeof entry?.path !== 'string' || entry.path.split(/[\\/]/).includes('..') || path.isAbsolute(entry.path)) {
        throw new HttpError(400, `Bad path in filemap: ${entry?.path}`)
      }
      if (entry.hash !== 'empty' && !isHash(entry.hash)) throw new HttpError(400, `Bad hash for ${entry.path}`)
      if (entry.hash !== 'empty' && !(await storage.exists(keys.object(access.projectId, entry.hash)))) {
        throw new HttpError(409, `Upload ${entry.path} before its filemap`)
      }
    }
    await storage.putJson(keys.filemap(access.projectId, commitId), filemap.map((e: any) => ({ path: e.path, hash: e.hash })))
    send(res, 200, { ok: true })
  }

  async function getFilemap(access: ProjectAccess, commitId: string, res: http.ServerResponse) {
    const filemap = await storage.getJson(keys.filemap(access.projectId, commitId))
    if (!filemap) throw new HttpError(404, 'No such version')
    send(res, 200, filemap)
  }

  /**
   * Routes `rest` (the path after the project prefix). Unknown routes are the
   * hidden 404 before any auth, exactly as before.
   */
  async function handle(rest: string[], authorize: Authorize, req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> {
    const method = req.method ?? 'GET'
    if (rest.length === 0 && method === 'GET') {
      const access = await authorize('listen')
      return send(res, 200, { role: access.role, log: await loadLog(access.projectId) })
    }
    if (rest[0] === 'log' && rest.length === 1 && method === 'PUT') return putLog(await authorize('edit'), req, res)
    if (rest[0] === 'objects' && rest[1] === 'missing' && method === 'POST') {
      return missingObjects(await authorize('edit'), req, res)
    }
    if (rest[0] === 'objects' && rest[1] === 'sizes' && method === 'POST') {
      return objectSizes(await authorize('listen'), req, res)
    }
    if (rest[0] === 'objects' && rest.length === 2 && isHash(rest[1])) {
      if (method === 'PUT') return putObject(await authorize('edit'), rest[1], req, res)
      if (method === 'GET' || method === 'HEAD') return getObject(await authorize('listen'), rest[1], req, res)
    }
    if (rest[0] === 'commits' && rest.length === 3 && isCommitId(rest[1])) {
      const commitId = rest[1]
      if (rest[2] === 'filemap' && method === 'PUT') return putFilemap(await authorize('edit'), commitId, req, res)
      if (rest[2] === 'filemap' && method === 'GET') return getFilemap(await authorize('edit'), commitId, res)
      // Comments are gone, but apps before 1.8 still call this on every sync:
      // answer with no comments so their sync keeps working.
      if (rest[2] === 'comments' && (method === 'GET' || method === 'POST')) {
        await authorize('listen')
        return send(res, 200, [])
      }
    }
    throw HIDDEN
  }

  /** The owner renamed the project: its log and meta carry the new name. */
  async function rename(projectId: string, name: string) {
    await withLock(keys.log(projectId), async () => {
      const log = await storage.getJson<SharedLog>(keys.log(projectId))
      if (log) await storage.putJson(keys.log(projectId), { ...log, name })
    })
    const meta = await storage.getJson<ProjectMeta>(keys.meta(projectId))
    if (meta) await storage.putJson(keys.meta(projectId), { ...meta, name, updatedAt: nowIso() })
  }

  return { handle, rename }
}

export function parseLog(value: unknown): SharedLog {
  const v = value as any
  const branchesOk = v?.branches === undefined || (Array.isArray(v.branches) && v.branches.every(
    (b: any) => b && typeof b === 'object' && (b.commits === undefined || (Array.isArray(b.commits) && b.commits.every((c: any) => c && typeof c === 'object'))),
  ))
  if (!v || typeof v !== 'object' || !branchesOk) throw new HttpError(400, 'Malformed version history')
  return toSharedLog(v)
}

/** Objects are stored by hash with no extension; tell browsers what audio they are from the first bytes. */
async function sniffType(storage: Storage, key: string, size: number): Promise<string> {
  if (size < 12) return 'application/octet-stream'
  const head = await storage.stream(key, { start: 0, end: 11 })
  if (!head) return 'application/octet-stream'
  const chunks: Buffer[] = []
  for await (const c of head) chunks.push(Buffer.from(c))
  const b = Buffer.concat(chunks)
  const ascii = (s: number, e: number) => b.subarray(s, e).toString('latin1')
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav'
  if (ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 4) === 'FORM') return 'audio/aiff'
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4'
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  return 'application/octet-stream'
}
