/** Storage keys and the server-side records kept under them (see docs/hub-spaces.md). */
import type { HubRole, SpaceRole } from '../../shared/hub-protocol.ts'
import { sha256 } from './http-util.ts'

export const keys = {
  token: (t: string) => tokenKey(sha256(t)),
  tokenByHash: (hash: string) => tokenKey(hash),
  /** Everything stored for one project: its log, versions and files. */
  project: (p: string) => `projects/${p}/`,
  meta: (p: string) => `projects/${p}/meta.json`,
  log: (p: string) => `projects/${p}/log.json`,
  filemap: (p: string, c: string) => `projects/${p}/commits/${c}/filemap.json`,
  object: (p: string, h: string) => `projects/${p}/objects/${h}`,
  spaceMeta: (s: string) => `spaces/${s}/meta.json`,
  members: (s: string) => `spaces/${s}/members.json`,
  invites: (s: string) => `spaces/${s}/invites.json`,
  spaceProjects: (s: string) => `spaces/${s}/projects.json`,
  /** codeHash -> where the invite lives, so a join finds its space without scanning. */
  inviteIndex: (codeHash: string) => `invites/${codeHash}.json`,
}

function tokenKey(hash: string) {
  return `tokens/${hash}.json`
}

/** A legacy per-project token. */
export interface ProjectTokenRecord {
  projectId: string
  role: HubRole
}

export interface MemberTokenRecord {
  kind: 'member'
  spaceId: string
  memberId: string
}

export type TokenRecord = ProjectTokenRecord | MemberTokenRecord

export const isMemberToken = (t: TokenRecord | null): t is MemberTokenRecord => (t as MemberTokenRecord | null)?.kind === 'member'

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt?: string
  spaceId?: string
}

export interface SpaceMetaRecord {
  id: string
  name: string
  createdAt: string
  deleted?: boolean
}

export interface MemberRecord {
  id: string
  name: string
  role: SpaceRole
  joinedAt: string
  tokenHash: string
}

export interface InviteRecord {
  id: string
  codeHash: string
  role: Exclude<SpaceRole, 'owner'>
  createdAt: string
  expiresAt: string
  maxUses: number
  uses: number
  createdBy: string
}

export interface InviteIndexRecord {
  spaceId: string
  inviteId: string
}

export interface SpaceProjectRecord {
  id: string
  name: string
  daw: string
  addedAt: string
  addedBy: string
}
