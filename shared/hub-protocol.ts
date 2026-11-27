/**
 * Shared between the DAWLab desktop app and the DAWLab Hub server.
 *
 * The hub is a "remote" for a DAWLab project, the way GitHub is a remote for
 * a git repo. Files travel as content-addressed blobs (SHA-256, the same
 * hashes the local CAS already uses), so either side only ever sends what the
 * other is missing. Version history (the project log) is a small JSON
 * document that both sides merge instead of overwriting, so two people can
 * work offline and sync later.
 *
 * Keep this file dependency-free: it is imported by the Electron main process
 * and run directly by Node (type stripping) on the server.
 */

export type HubRole = 'edit' | 'listen'

export interface SharedCommit {
  commit_id: string
  timestamp: string
  message: string
  author: string
  tags?: string[]
  preview_file?: string
  /** The version this one was saved on top of. Missing on versions saved before this was recorded. */
  parent?: string
  /** For "make main": the version from a parallel alternative this one takes over. */
  merged_from?: string
}

/** Set on an alternative the hub created because two people saved on top of the same version. */
export interface ForkInfo {
  /** The alternative both saved on (usually main). */
  branch: string
  /** The version both saved on top of. */
  parent: string
  /** Who saved second, whose versions went into this alternative. */
  author: string
}

/** Someone hid the "parallel version" notice for one version of a fork alternative, with a reason. */
export interface ForkDismissal {
  /** Who dismissed it (their name, as authors are recorded). */
  by: string
  /** The fork's newest version at the time; a newer one brings the notice back. */
  tip: string
  at: string
  comment: string
}

export interface SharedBranch {
  name: string
  commits: SharedCommit[]
  forkOf?: ForkInfo
  dismissed?: ForkDismissal[]
}

/** Dismissals that are well formed, one per person and version (the latest wins). */
export function cleanDismissals(list: unknown): ForkDismissal[] {
  if (!Array.isArray(list)) return []
  const byKey = new Map<string, ForkDismissal>()
  for (const d of list as any[]) {
    if (!d || typeof d.by !== 'string' || typeof d.tip !== 'string' || !d.by || !d.tip) continue
    const item = { by: d.by.slice(0, 100), tip: d.tip.slice(0, 64), at: String(d.at ?? '').slice(0, 40), comment: String(d.comment ?? '').slice(0, 1000) }
    const key = `${item.by}\u0000${item.tip}`
    const prev = byKey.get(key)
    if (!prev || prev.at <= item.at) byKey.set(key, item)
  }
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at))
}

/** The part of a project log that is shared. Local-only state (checkout, draft, paths) stays on each machine. */
export interface SharedLog {
  id: string
  name: string
  daw: string
  description?: string | null
  bpm?: number | null
  key?: string | null
  metadata?: unknown
  primaryFile?: string | null
  ignoredFiles?: string[]
  branches: SharedBranch[]
}

export interface ProjectResponse {
  role: HubRole
  log: SharedLog
}

export interface CreateProjectResponse {
  projectId: string
  editToken: string
  listenToken: string
  editUrl: string
  listenUrl: string
}

export const SHARED_LOG_FIELDS = [
  'id', 'name', 'daw', 'description', 'bpm', 'key', 'metadata', 'primaryFile', 'ignoredFiles',
] as const

const HASH_RE = /^[a-f0-9]{64}$/
const COMMIT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const isHash = (value: unknown): value is string => typeof value === 'string' && HASH_RE.test(value)
export const isCommitId = (value: unknown): value is string => typeof value === 'string' && COMMIT_ID_RE.test(value)

/** Strips a local project log down to what is safe and useful to share. */
/**
 * Versions DAWLab saved on its own before a switch ("Unsaved work before …")
 * stay on this Mac until you build on one: save on top of it, or make it main.
 */
export function privateSnapshotIds(log: any): Set<string> {
  const all = (log?.branches ?? []).flatMap((b: any) => b.commits ?? [])
  const priv = new Set<string>(all.filter((c: any) => c?.auto).map((c: any) => String(c.commit_id)))
  for (let changed = true; changed;) {
    changed = false
    for (const c of all) {
      if (priv.has(String(c.commit_id))) continue
      for (const ref of [c.parent, c.merged_from]) {
        if (ref && priv.delete(String(ref))) changed = true
      }
    }
  }
  return priv
}

export function toSharedLog(log: any): SharedLog {
  const out: any = {}
  for (const field of SHARED_LOG_FIELDS) {
    if (log?.[field] !== undefined) out[field] = log[field]
  }
  const hidden = privateSnapshotIds(log)
  out.branches = (log?.branches ?? []).map((b: any) => ({
    name: String(b.name),
    commits: (b.commits ?? []).filter((c: any) => !hidden.has(String(c.commit_id))).map((c: any) => {
      const commit: SharedCommit = {
        commit_id: String(c.commit_id),
        timestamp: String(c.timestamp ?? ''),
        message: String(c.message ?? ''),
        author: String(c.author ?? ''),
      }
      if (Array.isArray(c.tags)) commit.tags = c.tags.map(String)
      if (c.preview_file) commit.preview_file = String(c.preview_file)
      if (c.parent) commit.parent = String(c.parent)
      if (c.merged_from) commit.merged_from = String(c.merged_from)
      return commit
    }),
    ...(b.forkOf && typeof b.forkOf === 'object' && b.forkOf.branch && b.forkOf.parent
      ? { forkOf: { branch: String(b.forkOf.branch), parent: String(b.forkOf.parent), author: String(b.forkOf.author ?? '') } }
      : {}),
    ...(cleanDismissals(b.dismissed).length ? { dismissed: cleanDismissals(b.dismissed) } : {}),
  }))
  return out as SharedLog
}

/**
 * Merges `incoming` into `base` and returns a new log. Branches are matched by
 * name and commits by id: nothing is ever dropped, so a sync can't lose a
 * version. For a commit both sides know, fields `incoming` sets win (e.g. a
 * newly attached preview or edited tags). Shared top-level fields from
 * `incoming` win; any other field of `base` (local-only state) is kept.
 */
export function mergeLogs<T extends { branches?: any[] }>(base: T, incoming: SharedLog): T {
  const merged: any = { ...base }
  for (const field of SHARED_LOG_FIELDS) {
    if (field === 'id' && merged.id) continue
    if (incoming[field] !== undefined) merged[field] = incoming[field]
  }

  const branches: any[] = (base.branches ?? []).map((b: any) => ({ ...b, commits: [...(b.commits ?? [])] }))
  for (const inBranch of incoming.branches ?? []) {
    let branch = branches.find((b) => b.name === inBranch.name)
    if (!branch) {
      branch = { name: inBranch.name, commits: [] }
      branches.push(branch)
    }
    if (inBranch.forkOf && !branch.forkOf) branch.forkOf = { ...inBranch.forkOf }
    if (inBranch.dismissed?.length || branch.dismissed?.length) {
      branch.dismissed = cleanDismissals([...(branch.dismissed ?? []), ...(inBranch.dismissed ?? [])])
    }
    for (const inCommit of inBranch.commits ?? []) {
      const idx = branch.commits.findIndex((c: any) => String(c.commit_id) === inCommit.commit_id)
      if (idx === -1) branch.commits.push({ ...inCommit })
      else branch.commits[idx] = { ...branch.commits[idx], ...definedOnly(inCommit) }
    }
    branch.commits.sort((a: any, b: any) => String(a.timestamp).localeCompare(String(b.timestamp)))
  }
  merged.branches = branches
  return merged as T
}

/** Every blob a set of commits needs: their files plus their audio previews. */
export function allCommits(log: { branches?: any[] }): SharedCommit[] {
  const seen = new Map<string, SharedCommit>()
  for (const b of log.branches ?? []) for (const c of b.commits ?? []) seen.set(String(c.commit_id), c)
  return [...seen.values()]
}

/** A share link is `<hub origin>/s/<token>`; the same link opens the web player and the desktop app. */
export function parseShareLink(link: string): { hubUrl: string; token: string } {
  const url = new URL(link.trim())
  const match = url.pathname.match(/\/s\/([A-Za-z0-9_-]{20,})\/?$/)
  if (!match) throw new Error('Not a DAWLab share link (expected https://<hub>/s/<token>)')
  const base = url.pathname.slice(0, match.index)
  return { hubUrl: `${url.origin}${base}`, token: match[1] }
}

// ------------------------------------------------------------ spaces (shared folders)

/** A member's role in a space. See docs/hub-spaces.md. */
export type SpaceRole = 'owner' | 'edit' | 'listen'

export interface SpaceInfo {
  id: string
  name: string
  createdAt: string
}

export interface SpaceMember {
  id: string
  name: string
  role: SpaceRole
  joinedAt: string
}

/** `me` in space responses. */
export interface SpaceMe {
  id: string
  name: string
  role: SpaceRole
}

export interface SpaceProject {
  id: string
  name: string
  daw: string
  addedAt: string
  /** Member id of whoever added the project. */
  addedBy: string
  /** When the project's version history was last written. Only in GET /api/space. */
  updatedAt?: string
}

/** GET /api/space */
export interface SpaceResponse {
  space: SpaceInfo
  me: SpaceMe
  members: SpaceMember[]
  projects: SpaceProject[]
}

/**
 * GET /api/space/events (text/event-stream). `hello` when the stream opens,
 * `change` with this body when another member changed the folder, `closed`
 * just before the hub ends the stream for good (you were removed, or the
 * folder was deleted). Comment lines are heartbeats.
 */
export interface HubEvent {
  /** versions: new versions of a project; projects: added, renamed or deleted; space: folder name or members. */
  kind: 'versions' | 'projects' | 'space'
  projectId?: string
  /** Member who made the change; their own streams don't get it. */
  by?: string
}

/** POST /api/spaces (201) */
export interface CreateSpaceResponse {
  space: SpaceInfo
  me: SpaceMe
  token: string
}

/** POST /api/join (200) */
export type JoinResponse = CreateSpaceResponse

/** GET /api/space/invites: one entry. The code itself is never returned again. */
export interface InviteInfo {
  id: string
  role: Exclude<SpaceRole, 'owner'>
  expiresAt: string
  maxUses: number
  uses: number
}

/** POST /api/space/invites (201). `code` is formatted as DAWL-XXXX-XXXX-XXXX. */
export interface CreatedInvite {
  id: string
  code: string
  role: Exclude<SpaceRole, 'owner'>
  expiresAt: string
  maxUses: number
}

/** POST /api/invite/peek (200): what a code would join, without using it up. */
export interface InvitePreview {
  space: { id: string; name: string }
  role: Exclude<SpaceRole, 'owner'>
  /** Name of the member who created the invite (the owner). */
  invitedBy: string
  projectCount: number
  memberCount: number
  expiresAt: string
}

/** Crockford base32: 0-9 A-Z without I L O U. */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const INVITE_CODE_LENGTH = 12
const INVITE_PREFIX = 'DAWL'
const RAW_INVITE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/

/**
 * Canonical form of a typed or pasted invite code: the 12 raw characters.
 * Uppercases, drops everything but 0-9 A-Z, drops the DAWL prefix, and maps
 * the look-alikes I L -> 1 and O -> 0. The result may still be invalid; check
 * it with isInviteCode.
 */
export function normalizeInviteCode(code: string): string {
  let s = String(code ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (s.startsWith(INVITE_PREFIX) && s.length === INVITE_PREFIX.length + INVITE_CODE_LENGTH) s = s.slice(INVITE_PREFIX.length)
  return s.replace(/[IL]/g, '1').replace(/O/g, '0')
}

/** True when `value` (in any accepted spelling) normalizes to a well-formed invite code. */
export function isInviteCode(value: string): boolean {
  return typeof value === 'string' && RAW_INVITE_RE.test(normalizeInviteCode(value))
}

/** 12 raw characters -> `DAWL-XXXX-XXXX-XXXX`. Throws on anything that isn't a valid code. */
export function formatInviteCode(raw12: string): string {
  const raw = normalizeInviteCode(raw12)
  if (!RAW_INVITE_RE.test(raw)) throw new Error('Not a DAWLab invite code')
  return `${INVITE_PREFIX}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

/** Bytes -> Crockford base32 (no padding). */
function toBase32(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += INVITE_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += INVITE_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Crockford base32 -> bytes; null on a character outside the alphabet. Leftover bits are dropped. */
function fromBase32(text: string): Uint8Array | null {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of text) {
    const v = INVITE_ALPHABET.indexOf(ch)
    if (v < 0) return null
    value = ((value << 5) | v) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

const HUB_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/

/** Hub address -> what goes into a full invite: the bare host for https, the whole origin otherwise. */
function hubPayload(hubUrl: string): string {
  const url = new URL(hubUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The DAWLab server address must start with https://')
  const path = url.pathname.replace(/\/+$/, '')
  if (url.protocol === 'https:' && !path) return url.host.toLowerCase()
  return `${url.protocol}//${url.host.toLowerCase()}${path}`
}

function hubFromPayload(payload: string): string | null {
  if (payload.includes('://')) {
    try {
      const url = new URL(payload)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
      if (url.username || url.password || url.search || url.hash) return null
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
    } catch {
      return null
    }
  }
  return HUB_HOST_RE.test(payload) ? `https://${payload}` : null
}

/**
 * The invite people send: `DAWL-XXXX-XXXX-XXXX-` followed by the server
 * address in the same base32 alphabet, in groups of four. Joiners need
 * nothing else: no server address, no password. It is never a web link.
 */
export function buildFullInvite(hubUrl: string, code: string): string {
  const payload = toBase32(new TextEncoder().encode(hubPayload(hubUrl)))
  const groups = payload.match(/.{1,4}/g) ?? []
  return [formatInviteCode(code), ...groups].join('-')
}

/**
 * Reads any spelling of an invite: the full one (code + server) or a bare
 * `DAWL-XXXX-XXXX-XXXX`. `hubUrl` is null for a bare code. Returns null when
 * the text isn't an invite at all.
 */
export function parseFullInvite(text: string): { hubUrl: string | null; code: string } | null {
  const s = String(text ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (!s.startsWith(INVITE_PREFIX)) return isInviteCode(s) ? { hubUrl: null, code: normalizeInviteCode(s) } : null
  const body = s.slice(INVITE_PREFIX.length).replace(/[IL]/g, '1').replace(/O/g, '0')
  const code = body.slice(0, INVITE_CODE_LENGTH)
  if (!RAW_INVITE_RE.test(code)) return null
  const rest = body.slice(INVITE_CODE_LENGTH)
  if (!rest) return { hubUrl: null, code }
  const bytes = fromBase32(rest)
  if (!bytes || bytes.length === 0) return null
  let payload: string
  try {
    payload = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  const hubUrl = hubFromPayload(payload)
  return hubUrl ? { hubUrl, code } : null
}

/** `dawlab://join?hub=<urlencoded hub origin>&code=<code>` */
export function buildJoinLink(hubUrl: string, code: string): string {
  return `dawlab://join?hub=${encodeURIComponent(hubUrl.replace(/\/+$/, ''))}&code=${encodeURIComponent(formatInviteCode(code))}`
}

/** Parses an app join link. `code` comes back formatted (DAWL-XXXX-XXXX-XXXX); throws on a bad link. */
export function parseJoinLink(link: string): { hubUrl: string; code: string } {
  let url: URL
  try {
    url = new URL(String(link ?? '').trim())
  } catch {
    throw new Error('Not a DAWLab invite link')
  }
  const target = (url.hostname || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase()
  if (url.protocol !== 'dawlab:' || target !== 'join') throw new Error('Not a DAWLab invite link (expected dawlab://join?...)')
  const hub = url.searchParams.get('hub') ?? ''
  const code = url.searchParams.get('code') ?? ''
  let hubParsed: URL
  try {
    hubParsed = new URL(hub)
  } catch {
    throw new Error('The invite link has no valid hub address')
  }
  if (hubParsed.protocol !== 'https:' && hubParsed.protocol !== 'http:') throw new Error('The invite link has no valid hub address')
  if (!isInviteCode(code)) throw new Error('The invite link has no valid code')
  return { hubUrl: `${hubParsed.origin}${hubParsed.pathname.replace(/\/+$/, '')}`, code: formatInviteCode(code) }
}

function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
