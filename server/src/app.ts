/**
 * DAWLab Hub HTTP API. Plain node:http, no framework.
 *
 * Access is by capability token, no accounts: creating a project returns an
 * "edit" token (collaborators: push, pull, comment) and a "listen" token
 * (anyone with the link: play previews, read and add comments). Both are
 * shared as `<hub>/s/<token>` links. Only token hashes are stored.
 * Creating projects can be limited with HUB_CREATE_KEY.
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
  allCommits, isCommitId, isHash, mergeComments, mergeLogs, toSharedLog,
  type CreateProjectResponse, type HubRole, type SharedComment, type SharedLog,
} from '../../shared/hub-protocol.ts'

export interface HubOptions {
  storage: Storage
  /** When set, POST /api/projects needs `X-Hub-Key: <createKey>`. */
  createKey?: string
  /** Public origin used in share links; defaults to the request's Host. */
  publicUrl?: string
  /** Max size of one uploaded file, in bytes. */
  maxUploadBytes?: number
}

interface Access {
  projectId: string
  role: HubRole
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Thrown for anything a caller without a valid key or token could probe: answered with an empty 404. */
const HIDDEN = new HttpError(404, '')

const JSON_LIMIT = 8 * 1024 * 1024

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const newToken = () => crypto.randomBytes(24).toString('base64url')

/** Serializes read-modify-write of one JSON document within this process. */
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  locks.set(key, next)
  next.finally(() => { if (locks.get(key) === next) locks.delete(key) }).catch(() => {})
  return next
}

export function createHub(opts: HubOptions) {
  const { storage } = opts
  const maxUpload = opts.maxUploadBytes ?? 2 * 1024 * 1024 * 1024
  const keys = {
    token: (t: string) => `tokens/${sha256(t)}.json`,
    meta: (p: string) => `projects/${p}/meta.json`,
    log: (p: string) => `projects/${p}/log.json`,
    filemap: (p: string, c: string) => `projects/${p}/commits/${c}/filemap.json`,
    comments: (p: string, c: string) => `projects/${p}/commits/${c}/comments.json`,
    object: (p: string, h: string) => `projects/${p}/objects/${h}`,
  }

  async function authorize(req: http.IncomingMessage, url: URL, need: HubRole): Promise<Access> {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) throw HIDDEN
    const access = await storage.getJson<Access>(keys.token(token))
    if (!access) throw HIDDEN
    if (need === 'edit' && access.role !== 'edit') throw new HttpError(403, 'This link is listen-only')
    return access
  }

  async function loadLog(projectId: string): Promise<SharedLog> {
    const log = await storage.getJson<SharedLog>(keys.log(projectId))
    if (!log) throw new HttpError(404, 'Project not found')
    return log
  }

  function origin(req: http.IncomingMessage) {
    if (opts.publicUrl) return opts.publicUrl.replace(/\/+$/, '')
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || 'http'
    return `${proto}://${req.headers.host}`
  }

  // ---------------------------------------------------------------- routes

  async function createProject(req: http.IncomingMessage, res: http.ServerResponse) {
    if (opts.createKey) {
      const given = String(req.headers['x-hub-key'] ?? '')
      const a = Buffer.from(sha256(given)), b = Buffer.from(sha256(opts.createKey))
      if (!crypto.timingSafeEqual(a, b)) throw HIDDEN
    }
    const body = await readJson(req)
    const log = toSharedLog(body?.log ?? body)
    if (!log.name) throw new HttpError(400, 'Project name is required')
    const projectId = crypto.randomUUID()
    log.id = log.id || projectId
    const editToken = newToken()
    const listenToken = newToken()
    await storage.putJson(keys.meta(projectId), { id: projectId, name: log.name, createdAt: new Date().toISOString() })
    await storage.putJson(keys.log(projectId), { ...log, branches: [] })
    await storage.putJson(keys.token(editToken), { projectId, role: 'edit' })
    await storage.putJson(keys.token(listenToken), { projectId, role: 'listen' })
    const base = origin(req)
    const out: CreateProjectResponse = {
      projectId, editToken, listenToken, editUrl: `${base}/s/${editToken}`, listenUrl: `${base}/s/${listenToken}`,
    }
    send(res, 201, out)
  }

  async function putLog(access: Access, req: http.IncomingMessage, res: http.ServerResponse) {
    const incoming = toSharedLog(await readJson(req))
    const merged = await withLock(keys.log(access.projectId), async () => {
      const current = await loadLog(access.projectId)
      // Only accept versions whose filemap was uploaded first, so the log never points at missing data.
      for (const c of allCommits(incoming)) {
        if (!(await storage.exists(keys.filemap(access.projectId, c.commit_id)))) {
          throw new HttpError(409, `Upload the filemap of version ${c.commit_id} before the log`)
        }
      }
      const next = mergeLogs(current, { ...incoming, id: current.id })
      await storage.putJson(keys.log(access.projectId), next)
      return next
    })
    send(res, 200, { role: access.role, log: merged })
  }

  async function missingObjects(access: Access, req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readJson(req)
    const hashes: string[] = Array.isArray(body?.hashes) ? body.hashes.filter(isHash) : []
    const missing: string[] = []
    for (const h of new Set(hashes)) if (!(await storage.exists(keys.object(access.projectId, h)))) missing.push(h)
    send(res, 200, { missing })
  }

  async function putObject(access: Access, hash: string, req: http.IncomingMessage, res: http.ServerResponse) {
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

  async function getObject(access: Access, hash: string, req: http.IncomingMessage, res: http.ServerResponse) {
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
      'Content-Length': size === 0 ? 0 : range.end - range.start + 1,
    }
    if (range.kind === 'partial') headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    res.writeHead(range.kind === 'partial' ? 206 : 200, headers)
    if (req.method === 'HEAD' || size === 0) return res.end()
    const body = await storage.stream(key, { start: range.start, end: range.end })
    if (!body) return res.end()
    await pipeline(body, res)
  }

  async function putFilemap(access: Access, commitId: string, req: http.IncomingMessage, res: http.ServerResponse) {
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

  async function postComments(access: Access, commitId: string, req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readJson(req)
    const incoming: SharedComment[] = (Array.isArray(body) ? body : body?.comments ?? []).filter(
      (c: any) => c && typeof c.id === 'string' && c.id.length <= 64,
    )
    const log = await loadLog(access.projectId)
    if (!allCommits(log).some((c) => c.commit_id === commitId)) throw new HttpError(404, 'No such version')
    const key = keys.comments(access.projectId, commitId)
    const merged = await withLock(key, async () => {
      const current = (await storage.getJson<{ comments: SharedComment[] }>(key))?.comments ?? []
      const next = mergeComments(current, incoming)
      await storage.putJson(key, { version: 1, comments: next })
      return next
    })
    send(res, 200, merged)
  }

  // --------------------------------------------------------------- router

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://hub')
    const parts = url.pathname.split('/').filter(Boolean)
    const method = req.method ?? 'GET'

    // No pages and no unauthenticated endpoints: without a valid key or token
    // every request gets the same empty 404, so the hub reveals nothing.
    if (parts[0] !== 'api') throw HIDDEN

    if (url.pathname === '/api/projects' && method === 'POST') return createProject(req, res)

    // Everything below is scoped to the project the token belongs to.
    if (parts[1] !== 'project') throw HIDDEN
    const rest = parts.slice(2)

    if (rest.length === 0 && method === 'GET') {
      const access = await authorize(req, url, 'listen')
      return send(res, 200, { role: access.role, log: await loadLog(access.projectId) })
    }
    if (rest[0] === 'log' && rest.length === 1 && method === 'PUT') {
      return putLog(await authorize(req, url, 'edit'), req, res)
    }
    if (rest[0] === 'objects' && rest[1] === 'missing' && method === 'POST') {
      return missingObjects(await authorize(req, url, 'edit'), req, res)
    }
    if (rest[0] === 'objects' && rest.length === 2 && isHash(rest[1])) {
      if (method === 'PUT') return putObject(await authorize(req, url, 'edit'), rest[1], req, res)
      if (method === 'GET' || method === 'HEAD') return getObject(await authorize(req, url, 'listen'), rest[1], req, res)
    }
    if (rest[0] === 'commits' && rest.length === 3 && isCommitId(rest[1])) {
      const commitId = rest[1]
      if (rest[2] === 'filemap' && method === 'PUT') return putFilemap(await authorize(req, url, 'edit'), commitId, req, res)
      if (rest[2] === 'filemap' && method === 'GET') {
        const access = await authorize(req, url, 'edit')
        const filemap = await storage.getJson(keys.filemap(access.projectId, commitId))
        if (!filemap) throw new HttpError(404, 'No such version')
        return send(res, 200, filemap)
      }
      if (rest[2] === 'comments' && method === 'GET') {
        const access = await authorize(req, url, 'listen')
        const doc = await storage.getJson<{ comments: unknown[] }>(keys.comments(access.projectId, commitId))
        return send(res, 200, doc?.comments ?? [])
      }
      if (rest[2] === 'comments' && method === 'POST') {
        return postComments(await authorize(req, url, 'listen'), commitId, req, res)
      }
    }
    throw HIDDEN
  }

  return async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      await route(req, res)
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500
      if (status === 500) console.error('[hub]', req.method, req.url?.split('?')[0], err)
      if (res.headersSent) res.destroy()
      else if (err === HIDDEN) {
        req.resume()
        res.writeHead(404, { 'Content-Length': 0 })
        res.end()
      } else send(res, status, { error: status === 500 ? 'Internal error' : err.message })
    }
  }
}

// ---------------------------------------------------------------- helpers

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > JSON_LIMIT) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
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
