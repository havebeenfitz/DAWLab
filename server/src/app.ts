/**
 * DAWLab Hub HTTP API. Plain node:http, no framework.
 *
 * Access is by capability token, no accounts. Two ways to share:
 *  - Shared folders (spaces, see spaces.ts and docs/hub-spaces.md): each
 *    member has their own token; roles owner / edit / listen.
 *  - Legacy per-project links: creating a project returns an "edit" token
 *    (collaborators: push and pull) and a "listen" token (play previews),
 *    shared as `<hub>/s/<token>` links.
 * Only token hashes are stored. Creating projects and spaces can be limited
 * with HUB_CREATE_KEY.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import type { Storage } from './storage.ts'
import { isCommitId, type CreateProjectResponse, type HubRole } from '../../shared/hub-protocol.ts'
import {
  HIDDEN, HttpError, checkHubKey, createFailureLimiter, newToken, readJson, requestToken, send,
} from './http-util.ts'
import { isMemberToken, keys, type ProjectTokenRecord, type TokenRecord } from './keys.ts'
import { createProjectRoutes, parseLog, type ProjectAccess } from './project-routes.ts'
import { createSpaceRoutes } from './spaces.ts'
import { createEventBus } from './events.ts'

export interface HubOptions {
  storage: Storage
  /** When set, POST /api/projects and POST /api/spaces need `X-Hub-Key: <createKey>`. */
  createKey?: string
  /** Public origin used in share links; defaults to the request's Host. */
  publicUrl?: string
  /** Max size of one uploaded file, in bytes. */
  maxUploadBytes?: number
  /** How often open event streams get a heartbeat (tests use a short one). */
  heartbeatMs?: number
}

export function createHub(opts: HubOptions) {
  const { storage } = opts
  const maxUpload = opts.maxUploadBytes ?? 2 * 1024 * 1024 * 1024
  /** At most 10 wrong hub keys per address per 15 minutes; after that even the right key gets the hidden 404. */
  const keyFailures = createFailureLimiter()
  const projectRoutes = createProjectRoutes(storage, maxUpload)
  const events = createEventBus(opts.heartbeatMs)
  const spaceRoutes = createSpaceRoutes({ storage, createKey: opts.createKey, keyLimiter: keyFailures, projectRoutes, events })

  /** Legacy project tokens only; member tokens are the hidden 404 here. */
  async function authorizeLegacy(req: http.IncomingMessage, need: HubRole): Promise<ProjectAccess> {
    const token = requestToken(req)
    const record = await storage.getJson<TokenRecord>(keys.token(token))
    if (!record || isMemberToken(record)) throw HIDDEN
    const access: ProjectTokenRecord = record
    if (need === 'edit' && access.role !== 'edit') throw new HttpError(403, 'This link is listen-only')
    return { projectId: access.projectId, role: access.role }
  }

  function origin(req: http.IncomingMessage) {
    if (opts.publicUrl) return opts.publicUrl.replace(/\/+$/, '')
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || 'http'
    return `${proto}://${req.headers.host}`
  }

  async function createProject(req: http.IncomingMessage, res: http.ServerResponse) {
    checkHubKey(req, opts.createKey, keyFailures)
    const body = await readJson(req)
    const parsed = parseLog(body?.log ?? body)
    if (!parsed.name) throw new HttpError(400, 'Project name is required')
    const projectId = crypto.randomUUID()
    const log = { ...parsed, id: isCommitId(parsed.id) ? parsed.id : projectId, branches: [] }
    const editToken = newToken()
    const listenToken = newToken()
    const createdAt = new Date().toISOString()
    await storage.putJson(keys.meta(projectId), { id: projectId, name: log.name, createdAt, updatedAt: createdAt })
    await storage.putJson(keys.log(projectId), log)
    await storage.putJson(keys.token(editToken), { projectId, role: 'edit' })
    await storage.putJson(keys.token(listenToken), { projectId, role: 'listen' })
    const base = origin(req)
    const out: CreateProjectResponse = {
      projectId, editToken, listenToken, editUrl: `${base}/s/${editToken}`, listenUrl: `${base}/s/${listenToken}`,
    }
    send(res, 201, out)
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://hub')
    } catch {
      throw HIDDEN
    }
    const parts = url.pathname.split('/').filter(Boolean)

    // No pages and no unauthenticated endpoints: without a valid key, token or
    // invite code every request gets the same empty 404, so the hub reveals nothing.
    if (parts[0] !== 'api') throw HIDDEN

    if (url.pathname === '/api/projects' && req.method === 'POST') return createProject(req, res)
    if (await spaceRoutes.handle(parts.slice(1), req, res)) return

    // Legacy: everything below is scoped to the project the token belongs to.
    if (parts[1] !== 'project') throw HIDDEN
    return projectRoutes.handle(parts.slice(2), (need) => authorizeLegacy(req, need), req, res)
  }

  async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      await route(req, res)
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500
      if (status === 500) console.error('[hub]', req.method, req.url?.split('?')[0], err)
      if (res.headersSent) res.destroy()
      else if (err === HIDDEN) {
        // Don't read whatever body an unauthenticated client is sending: answer and hang up.
        res.writeHead(404, { 'Content-Length': 0, Connection: 'close' })
        res.end(() => req.socket.destroy())
      } else send(res, status, { error: status === 500 ? 'Internal error' : err.message })
    }
  }

  /** The request handler, plus `shutdown` to end open event streams before the server closes. */
  return Object.assign(handler, { shutdown: events.shutdown })
}
