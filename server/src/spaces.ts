/**
 * Shared folders ("spaces"): POST /api/spaces, POST /api/join,
 * POST /api/invite/peek and everything under /api/space. See docs/hub-spaces.md.
 *
 * A member token resolves to (space, member); the role is read from
 * members.json on every request, so role changes and removals apply at once.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { isCommitId, type HubEvent, type HubRole, type InvitePreview, type JoinResponse, type SpaceResponse } from '../../shared/hub-protocol.ts'
import type { Storage } from './storage.ts'
import {
  HIDDEN, HttpError, checkHubKey, clientIp, createFailureLimiter, displayName, isId, nowIso, readJson, requestToken,
  send, sha256, type FailureLimiter,
} from './http-util.ts'
import { isMemberToken, keys, type MemberRecord, type SpaceMetaRecord, type TokenRecord } from './keys.ts'
import { createInviteStore } from './invites.ts'
import { createSpaceStore, toMe, toMember, toSpaceInfo, toSpaceProject } from './space-store.ts'
import { parseLog, type Authorize, type createProjectRoutes } from './project-routes.ts'
import type { EventBus } from './events.ts'

interface SpaceOptions {
  storage: Storage
  createKey?: string
  keyLimiter: FailureLimiter
  projectRoutes: ReturnType<typeof createProjectRoutes>
  events: EventBus
}

interface Caller {
  space: SpaceMetaRecord
  member: MemberRecord
}

type Req = http.IncomingMessage
type Res = http.ServerResponse

export function createSpaceRoutes(opts: SpaceOptions) {
  const { storage, projectRoutes, events } = opts
  const store = createSpaceStore(storage)
  const invites = createInviteStore(storage)
  /** Failed joins and peeks: 10 per address per 15 minutes, then everything is the hidden 404. */
  const joinFailures = createFailureLimiter()

  async function authenticate(req: Req): Promise<Caller> {
    const token = requestToken(req)
    const record = await storage.getJson<TokenRecord>(keys.token(token))
    if (!isMemberToken(record) || !isId(record.spaceId)) throw HIDDEN
    const space = await store.meta(record.spaceId)
    if (!space || space.deleted) throw HIDDEN
    const tokenHash = sha256(token)
    const member = (await store.members(space.id)).find((m) => m.id === record.memberId && m.tokenHash === tokenHash)
    if (!member) throw HIDDEN
    return { space, member }
  }

  const requireOwner = (c: Caller) => {
    if (c.member.role !== 'owner') throw new HttpError(403, 'Only the owner of this folder can do that')
  }
  const requireWriter = (c: Caller) => {
    if (c.member.role === 'listen') throw new HttpError(403, 'You can listen in this folder, not change it')
  }

  // ------------------------------------------------------------ no token

  async function createSpace(req: Req, res: Res) {
    checkHubKey(req, opts.createKey, opts.keyLimiter)
    const body = await readJson(req)
    const name = displayName(body?.name, 'Folder name', 100)
    const memberName = displayName(body?.memberName, 'Your name')
    const space = await store.createSpace(name)
    const { member, token } = await store.addMember(space.id, memberName, 'owner')
    const out: JoinResponse = { space: toSpaceInfo(space), me: toMe(member), token }
    send(res, 201, out)
  }

  /** Runs `fn`; a hidden 404 from it counts as a failure for this address. Blocked addresses get only hidden 404s. */
  async function limited<T>(req: Req, fn: () => Promise<T>): Promise<T> {
    const ip = clientIp(req)
    if (joinFailures.blocked(ip)) throw HIDDEN
    try {
      return await fn()
    } catch (err) {
      if (err === HIDDEN) joinFailures.fail(ip)
      throw err
    }
  }

  async function liveInvite(code: unknown) {
    const found = await invites.find(code)
    const space = await store.meta(found.spaceId)
    if (!space || space.deleted) throw HIDDEN
    return { ...found, space }
  }

  /** Reads `{ code, ... }` and resolves a live invite. Any failure, malformed JSON included, is the hidden 404. */
  function readInvite(req: Req) {
    return limited(req, async () => {
      const body = await readJson(req).catch(() => { throw HIDDEN })
      return { body, ...(await liveInvite(body?.code)) }
    })
  }

  async function join(req: Req, res: Res) {
    const { body, space, invite } = await readInvite(req)
    const memberName = displayName(body?.memberName, 'Your name')
    await limited(req, () => invites.consume(space.id, invite.id))
    const { member, token } = await store.addMember(space.id, memberName, invite.role)
    const out: JoinResponse = { space: toSpaceInfo(space), me: toMe(member), token }
    send(res, 200, out)
    events.publish(space.id, { kind: 'space', by: member.id })
  }

  async function peek(req: Req, res: Res) {
    const { space, invite } = await readInvite(req)
    const [members, projects] = await Promise.all([store.members(space.id), store.projects(space.id)])
    const inviter = members.find((m) => m.id === invite.createdBy) ?? members.find((m) => m.role === 'owner')
    const out: InvitePreview = {
      space: { id: space.id, name: space.name }, role: invite.role, invitedBy: inviter?.name ?? '',
      projectCount: projects.length, memberCount: members.length, expiresAt: invite.expiresAt,
    }
    send(res, 200, out)
  }

  // ---------------------------------------------------------- /api/space

  async function getSpace(c: Caller, res: Res) {
    const [members, projects] = await Promise.all([store.members(c.space.id), store.listProjects(c.space.id)])
    const out: SpaceResponse = { space: toSpaceInfo(c.space), me: toMe(c.member), members: members.map(toMember), projects }
    send(res, 200, out)
  }

  async function routeMembers(c: Caller, memberId: string, req: Req, res: Res) {
    const method = req.method
    if (method === 'PATCH') {
      requireOwner(c)
      const role = (await readJson(req))?.role
      if (role !== 'edit' && role !== 'listen') throw new HttpError(400, 'Role must be edit or listen')
      return send(res, 200, { member: toMember(await store.setRole(c.space.id, memberId, role)) })
    }
    if (method === 'DELETE') {
      if (c.member.role !== 'owner' && c.member.id !== memberId) throw new HttpError(403, 'Only the owner of this folder can do that')
      await store.removeMember(c.space.id, memberId)
      return send(res, 204)
    }
    throw HIDDEN
  }

  async function addProject(c: Caller, req: Req, res: Res) {
    requireWriter(c)
    const body = await readJson(req)
    const parsed = parseLog(body?.log ?? body)
    if (!parsed.name) throw new HttpError(400, 'Project name is required')
    const projectId = crypto.randomUUID()
    const log = { ...parsed, id: isCommitId(parsed.id) ? parsed.id : projectId, branches: [] }
    const addedAt = nowIso()
    await storage.putJson(keys.meta(projectId), { id: projectId, name: log.name, createdAt: addedAt, updatedAt: addedAt, spaceId: c.space.id })
    await storage.putJson(keys.log(projectId), log)
    const project = { id: projectId, name: log.name, daw: String(log.daw ?? ''), addedAt, addedBy: c.member.id }
    await store.addProject(c.space.id, project)
    send(res, 201, { project: toSpaceProject(project) })
  }

  /** Access to one project of the caller's space; any project outside it is the hidden 404. */
  function projectAuthorizer(c: Caller, projectId: string): Authorize {
    return async (need: HubRole) => {
      if (!(await store.projects(c.space.id)).some((p) => p.id === projectId)) throw HIDDEN
      if (need === 'edit') requireWriter(c)
      return {
        projectId,
        role: c.member.role === 'listen' ? 'listen' : 'edit',
        member: { id: c.member.id, isOwner: c.member.role === 'owner' },
      }
    }
  }

  async function routeProjects(c: Caller, rest: string[], req: Req, res: Res) {
    if (rest.length === 0) {
      if (req.method === 'POST') return addProject(c, req, res)
      throw HIDDEN
    }
    const projectId = rest[0]
    if (!isId(projectId)) throw HIDDEN
    if (rest.length === 1 && req.method === 'DELETE') {
      if (!(await store.projects(c.space.id)).some((p) => p.id === projectId)) throw HIDDEN
      requireOwner(c)
      await store.removeProject(c.space.id, projectId)
      // Deleted for good: its versions and files go too, so the space comes back.
      await storage.deletePrefix(keys.project(projectId))
      return send(res, 204)
    }
    if (rest.length === 1 && req.method === 'PATCH') {
      if (!(await store.projects(c.space.id)).some((p) => p.id === projectId)) throw HIDDEN
      requireOwner(c)
      const name = displayName((await readJson(req))?.name, 'Project name', 120)
      if (/[\\/:*?"<>|\p{Cc}]/u.test(name) || name.startsWith('.')) throw new HttpError(400, 'That name can’t be used for a folder')
      await projectRoutes.rename(projectId, name)
      await store.renameProject(c.space.id, projectId, name)
      const project = (await store.listProjects(c.space.id)).find((p) => p.id === projectId)
      return send(res, 200, { project })
    }
    return projectRoutes.handle(rest.slice(1), projectAuthorizer(c, projectId), req, res)
  }

  /** What a successful write under /api/space changed, for the other members' event streams. */
  function changeOf(rest: string[], method: string | undefined): HubEvent | null {
    if (rest.length === 0) return method === 'PATCH' ? { kind: 'space' } : null
    if (rest[0] === 'members' && (method === 'PATCH' || method === 'DELETE')) return { kind: 'space' }
    if (rest[0] !== 'projects') return null
    if (rest.length === 1) return method === 'POST' ? { kind: 'projects' } : null
    if (rest.length === 2 && (method === 'PATCH' || method === 'DELETE')) return { kind: 'projects', projectId: rest[1] }
    if (rest.length === 3 && rest[2] === 'log' && method === 'PUT') return { kind: 'versions', projectId: rest[1] }
    return null
  }

  async function routeSpace(rest: string[], req: Req, res: Res) {
    const c = await authenticate(req)
    const method = req.method
    if (rest.length === 1 && rest[0] === 'events' && method === 'GET') return events.open(c.space.id, c.member.id, req, res)
    await routeSpaceWrite(c, rest, req, res)
    if (res.statusCode >= 400) return
    const change = changeOf(rest, method)
    if (change) events.publish(c.space.id, { ...change, by: c.member.id })
    if (rest.length === 0 && method === 'DELETE') events.close(c.space.id)
    if (rest[0] === 'members' && method === 'DELETE') events.close(c.space.id, rest[1])
  }

  async function routeSpaceWrite(c: Caller, rest: string[], req: Req, res: Res) {
    const method = req.method
    if (rest.length === 0) {
      if (method === 'GET') return getSpace(c, res)
      if (method === 'PATCH') {
        requireOwner(c)
        const name = displayName((await readJson(req))?.name, 'Folder name', 100)
        return send(res, 200, { space: toSpaceInfo(await store.renameSpace(c.space.id, name)) })
      }
      if (method === 'DELETE') {
        requireOwner(c)
        await invites.removeAll(c.space.id)
        await store.deleteSpace(c.space.id)
        return send(res, 204)
      }
      throw HIDDEN
    }
    if (rest[0] === 'members' && rest.length === 2 && isId(rest[1])) return routeMembers(c, rest[1], req, res)
    if (rest[0] === 'invites' && rest.length === 1) {
      if (method === 'GET') {
        requireOwner(c)
        return send(res, 200, await invites.list(c.space.id))
      }
      if (method === 'POST') {
        requireOwner(c)
        return send(res, 201, await invites.create(c.space.id, c.member.id, await readJson(req)))
      }
    }
    if (rest[0] === 'invites' && rest.length === 2 && isId(rest[1]) && method === 'DELETE') {
      requireOwner(c)
      await invites.revoke(c.space.id, rest[1])
      return send(res, 204)
    }
    if (rest[0] === 'storage' && rest.length === 1 && method === 'GET') {
      // Only the owner sees how full the server is.
      requireOwner(c)
      const space = storage.diskSpace ? await storage.diskSpace() : null
      return send(res, 200, { kind: storage.kind, ...(space ?? { totalBytes: null, freeBytes: null }) })
    }
    if (rest[0] === 'projects') return routeProjects(c, rest.slice(1), req, res)
    throw HIDDEN
  }

  /** Handles a request if it is a spaces route; returns false otherwise. `parts` is the path after /api. */
  async function handle(parts: string[], req: Req, res: Res): Promise<boolean> {
    const method = req.method
    if (parts.length === 1 && parts[0] === 'spaces' && method === 'POST') return createSpace(req, res).then(() => true)
    if (parts.length === 1 && parts[0] === 'join' && method === 'POST') return join(req, res).then(() => true)
    if (parts.length === 2 && parts[0] === 'invite' && parts[1] === 'peek' && method === 'POST') return peek(req, res).then(() => true)
    if (parts[0] === 'space') return routeSpace(parts.slice(1), req, res).then(() => true)
    return false
  }

  return { handle }
}
