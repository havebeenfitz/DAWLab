/** Read-modify-write of a space's members, projects and meta, each under its own lock. */
import crypto from 'node:crypto'
import type { SpaceInfo, SpaceMe, SpaceMember, SpaceProject, SpaceRole } from '../../shared/hub-protocol.ts'
import type { Storage } from './storage.ts'
import { HttpError, newToken, nowIso, sha256, withLock } from './http-util.ts'
import {
  keys, type MemberRecord, type MemberTokenRecord, type ProjectMeta, type SpaceMetaRecord, type SpaceProjectRecord,
} from './keys.ts'

export const toSpaceInfo = (s: SpaceMetaRecord): SpaceInfo => ({ id: s.id, name: s.name, createdAt: s.createdAt })
export const toMe = (m: MemberRecord): SpaceMe => ({ id: m.id, name: m.name, role: m.role })
export const toMember = (m: MemberRecord): SpaceMember => ({ id: m.id, name: m.name, role: m.role, joinedAt: m.joinedAt })
export const toSpaceProject = (p: SpaceProjectRecord): SpaceProject =>
  ({ id: p.id, name: p.name, daw: p.daw, addedAt: p.addedAt, addedBy: p.addedBy })

export function createSpaceStore(storage: Storage) {
  const meta = (spaceId: string) => storage.getJson<SpaceMetaRecord>(keys.spaceMeta(spaceId))
  const members = async (spaceId: string) => (await storage.getJson<MemberRecord[]>(keys.members(spaceId))) ?? []
  const projects = async (spaceId: string) => (await storage.getJson<SpaceProjectRecord[]>(keys.spaceProjects(spaceId))) ?? []

  /** Applies `fn` to a space's member list under its lock and writes the result back. */
  function updateMembers<T>(spaceId: string, fn: (list: MemberRecord[]) => { next: MemberRecord[]; result: T }): Promise<T> {
    return withLock(keys.members(spaceId), async () => {
      const { next, result } = fn(await members(spaceId))
      await storage.putJson(keys.members(spaceId), next)
      return result
    })
  }

  async function createSpace(name: string): Promise<SpaceMetaRecord> {
    const space: SpaceMetaRecord = { id: crypto.randomUUID(), name, createdAt: nowIso() }
    await storage.putJson(keys.spaceMeta(space.id), space)
    await storage.putJson(keys.members(space.id), [])
    await storage.putJson(keys.invites(space.id), [])
    await storage.putJson(keys.spaceProjects(space.id), [])
    return space
  }

  async function renameSpace(spaceId: string, name: string): Promise<SpaceMetaRecord> {
    return withLock(keys.spaceMeta(spaceId), async () => {
      const current = await meta(spaceId)
      if (!current) throw new HttpError(404, 'This folder no longer exists')
      const next = { ...current, name }
      await storage.putJson(keys.spaceMeta(spaceId), next)
      return next
    })
  }

  /** Marks the space deleted and removes every member's token. */
  async function deleteSpace(spaceId: string): Promise<void> {
    await withLock(keys.spaceMeta(spaceId), async () => {
      const current = await meta(spaceId)
      if (current) await storage.putJson(keys.spaceMeta(spaceId), { ...current, deleted: true })
    })
    const gone = await updateMembers(spaceId, (list) => ({ next: [], result: list }))
    for (const m of gone) await storage.delete(keys.tokenByHash(m.tokenHash))
  }

  /** Adds a member and issues their token. */
  async function addMember(spaceId: string, name: string, role: SpaceRole): Promise<{ member: MemberRecord; token: string }> {
    const token = newToken()
    const member: MemberRecord = { id: crypto.randomUUID(), name, role, joinedAt: nowIso(), tokenHash: sha256(token) }
    await updateMembers(spaceId, (list) => ({ next: [...list, member], result: undefined }))
    const record: MemberTokenRecord = { kind: 'member', spaceId, memberId: member.id }
    await storage.putJson(keys.token(token), record)
    return { member, token }
  }

  async function setRole(spaceId: string, memberId: string, role: 'edit' | 'listen'): Promise<MemberRecord> {
    return updateMembers(spaceId, (list) => {
      const target = list.find((m) => m.id === memberId)
      if (!target) throw new HttpError(404, 'That person is no longer in this folder')
      if (target.role === 'owner') throw new HttpError(400, "The owner's role can't be changed")
      const updated = { ...target, role }
      return { next: list.map((m) => (m.id === memberId ? updated : m)), result: updated }
    })
  }

  /** Removes a member and deletes their token. The owner can't be removed. */
  async function removeMember(spaceId: string, memberId: string): Promise<void> {
    const removed = await updateMembers(spaceId, (list) => {
      const target = list.find((m) => m.id === memberId)
      if (!target) throw new HttpError(404, 'That person is no longer in this folder')
      if (target.role === 'owner') throw new HttpError(400, "The owner can't leave; delete the folder instead")
      return { next: list.filter((m) => m.id !== memberId), result: target }
    })
    await storage.delete(keys.tokenByHash(removed.tokenHash))
  }

  async function addProject(spaceId: string, project: SpaceProjectRecord): Promise<void> {
    await withLock(keys.spaceProjects(spaceId), async () => {
      await storage.putJson(keys.spaceProjects(spaceId), [...(await projects(spaceId)), project])
    })
  }

  /** Removes a project from the space; returns false when it wasn't in it. */
  async function removeProject(spaceId: string, projectId: string): Promise<boolean> {
    return withLock(keys.spaceProjects(spaceId), async () => {
      const list = await projects(spaceId)
      if (!list.some((p) => p.id === projectId)) return false
      await storage.putJson(keys.spaceProjects(spaceId), list.filter((p) => p.id !== projectId))
      return true
    })
  }

  /** Renames a project in the space's list; returns false when it wasn't in it. */
  async function renameProject(spaceId: string, projectId: string, name: string): Promise<boolean> {
    return withLock(keys.spaceProjects(spaceId), async () => {
      const list = await projects(spaceId)
      if (!list.some((p) => p.id === projectId)) return false
      await storage.putJson(keys.spaceProjects(spaceId), list.map((p) => (p.id === projectId ? { ...p, name } : p)))
      return true
    })
  }

  /** The space's projects with `updatedAt` from each project's meta. */
  async function listProjects(spaceId: string): Promise<SpaceProject[]> {
    const list = await projects(spaceId)
    return Promise.all(list.map(async (p) => {
      const m = await storage.getJson<ProjectMeta>(keys.meta(p.id))
      return { ...toSpaceProject(p), updatedAt: m?.updatedAt ?? m?.createdAt ?? p.addedAt }
    }))
  }

  return {
    meta, members, projects, createSpace, renameSpace, deleteSpace, addMember, setRole, removeMember,
    addProject, removeProject, renameProject, listProjects,
  }
}

export type SpaceStore = ReturnType<typeof createSpaceStore>
