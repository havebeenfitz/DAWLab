/** Invite codes for spaces: creation, listing, revoking and redeeming. Only code hashes are stored. */
import crypto from 'node:crypto'
import {
  INVITE_ALPHABET, INVITE_CODE_LENGTH, formatInviteCode, isInviteCode, normalizeInviteCode,
  type CreatedInvite, type InviteInfo,
} from '../../shared/hub-protocol.ts'
import type { Storage } from './storage.ts'
import { HIDDEN, HttpError, nowIso, sha256, withLock } from './http-util.ts'
import { keys, type InviteIndexRecord, type InviteRecord } from './keys.ts'

const DAY = 24 * 60 * 60 * 1000
export const INVITE_DEFAULTS = { expiresInDays: 7, maxUses: 10 } as const

/** 12 Crockford base32 characters from 60 random bits. */
export function generateRawInviteCode(): string {
  let bits = crypto.randomBytes(8).readBigUInt64BE() >> 4n
  let out = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out = INVITE_ALPHABET[Number(bits & 31n)] + out
    bits >>= 5n
  }
  return out
}

export const hashInviteCode = (code: string): string => sha256(normalizeInviteCode(code))

function intInRange(value: unknown, fallback: number, min: number, max: number, what: string): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${what} must be a whole number from ${min} to ${max}`)
  }
  return value
}

export const toInviteInfo = (i: InviteRecord): InviteInfo =>
  ({ id: i.id, role: i.role, expiresAt: i.expiresAt, maxUses: i.maxUses, uses: i.uses })

const usable = (i: InviteRecord, now: number) => Date.parse(i.expiresAt) > now && i.uses < i.maxUses

export function createInviteStore(storage: Storage) {
  const load = async (spaceId: string) => (await storage.getJson<InviteRecord[]>(keys.invites(spaceId))) ?? []

  async function create(spaceId: string, createdBy: string, body: any): Promise<CreatedInvite> {
    const role = body?.role
    if (role !== 'edit' && role !== 'listen') throw new HttpError(400, 'Choose whether the invite is to edit or to listen')
    const days = intInRange(body?.expiresInDays, INVITE_DEFAULTS.expiresInDays, 1, 30, 'Days until it expires')
    const maxUses = intInRange(body?.maxUses, INVITE_DEFAULTS.maxUses, 1, 100, 'Number of uses')
    const raw = generateRawInviteCode()
    const createdAt = nowIso()
    const invite: InviteRecord = {
      id: crypto.randomUUID(), codeHash: hashInviteCode(raw), role, createdAt,
      expiresAt: new Date(Date.parse(createdAt) + days * DAY).toISOString(), maxUses, uses: 0, createdBy,
    }
    await storage.putJson(keys.inviteIndex(invite.codeHash), { spaceId, inviteId: invite.id } satisfies InviteIndexRecord)
    await withLock(keys.invites(spaceId), async () => {
      await storage.putJson(keys.invites(spaceId), [...(await load(spaceId)), invite])
    })
    return { id: invite.id, code: formatInviteCode(raw), role, expiresAt: invite.expiresAt, maxUses }
  }

  async function list(spaceId: string): Promise<InviteInfo[]> {
    return (await load(spaceId)).map(toInviteInfo)
  }

  async function revoke(spaceId: string, inviteId: string): Promise<void> {
    const removed = await withLock(keys.invites(spaceId), async () => {
      const all = await load(spaceId)
      const hit = all.find((i) => i.id === inviteId)
      if (!hit) throw new HttpError(404, 'That invite no longer exists')
      await storage.putJson(keys.invites(spaceId), all.filter((i) => i.id !== inviteId))
      return hit
    })
    await storage.delete(keys.inviteIndex(removed.codeHash))
  }

  /** Where a code points, or HIDDEN. Doesn't use it up. */
  async function find(code: unknown): Promise<{ spaceId: string; invite: InviteRecord }> {
    if (typeof code !== 'string' || !isInviteCode(code)) throw HIDDEN
    const codeHash = hashInviteCode(code)
    const index = await storage.getJson<InviteIndexRecord>(keys.inviteIndex(codeHash))
    if (!index) throw HIDDEN
    const invite = (await load(index.spaceId)).find((i) => i.id === index.inviteId && i.codeHash === codeHash)
    if (!invite || !usable(invite, Date.now())) throw HIDDEN
    return { spaceId: index.spaceId, invite }
  }

  /** Counts one use of the invite; HIDDEN if it was revoked, expired or used up meanwhile. */
  async function consume(spaceId: string, inviteId: string): Promise<InviteRecord> {
    return withLock(keys.invites(spaceId), async () => {
      const all = await load(spaceId)
      const hit = all.find((i) => i.id === inviteId)
      if (!hit || !usable(hit, Date.now())) throw HIDDEN
      const updated = { ...hit, uses: hit.uses + 1 }
      await storage.putJson(keys.invites(spaceId), all.map((i) => (i.id === inviteId ? updated : i)))
      return updated
    })
  }

  /** Drops every index entry of a space's invites (when the space is deleted). */
  async function removeAll(spaceId: string): Promise<void> {
    const all = await withLock(keys.invites(spaceId), async () => {
      const list = await load(spaceId)
      await storage.putJson(keys.invites(spaceId), [])
      return list
    })
    for (const i of all) await storage.delete(keys.inviteIndex(i.codeHash))
  }

  return { create, list, revoke, find, consume, removeAll }
}
