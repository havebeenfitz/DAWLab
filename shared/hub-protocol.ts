/**
 * Shared between the DAWLab desktop app and the DAWLab Hub server.
 *
 * The hub is a "remote" for a DAWLab project, the way GitHub is a remote for
 * a git repo. Files travel as content-addressed blobs (SHA-256, the same
 * hashes the local CAS already uses), so either side only ever sends what the
 * other is missing. Version history (the project log) and per-version feedback
 * comments are small JSON documents that both sides merge instead of
 * overwriting, so two people can work offline and sync later.
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
}

export interface SharedBranch {
  name: string
  commits: SharedCommit[]
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

export interface SharedComment {
  id: string
  replies?: Array<{ id: string } & Record<string, unknown>>
  [key: string]: unknown
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
export function toSharedLog(log: any): SharedLog {
  const out: any = {}
  for (const field of SHARED_LOG_FIELDS) {
    if (log?.[field] !== undefined) out[field] = log[field]
  }
  out.branches = (log?.branches ?? []).map((b: any) => ({
    name: String(b.name),
    commits: (b.commits ?? []).map((c: any) => {
      const commit: SharedCommit = {
        commit_id: String(c.commit_id),
        timestamp: String(c.timestamp ?? ''),
        message: String(c.message ?? ''),
        author: String(c.author ?? ''),
      }
      if (Array.isArray(c.tags)) commit.tags = c.tags.map(String)
      if (c.preview_file) commit.preview_file = String(c.preview_file)
      return commit
    }),
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

/** Union of two comment lists by id (and of each comment's replies by id); `incoming` wins on conflicts. */
export function mergeComments(base: SharedComment[], incoming: SharedComment[]): SharedComment[] {
  const out = base.map((c) => ({ ...c }))
  for (const inc of incoming) {
    if (!inc || typeof inc.id !== 'string') continue
    const idx = out.findIndex((c) => c.id === inc.id)
    if (idx === -1) {
      out.push({ ...inc })
      continue
    }
    const replies = [...(out[idx].replies ?? [])]
    for (const r of inc.replies ?? []) {
      const ri = replies.findIndex((x) => x.id === r.id)
      if (ri === -1) replies.push(r)
      else replies[ri] = { ...replies[ri], ...r }
    }
    out[idx] = { ...out[idx], ...inc, ...(replies.length ? { replies } : {}) }
  }
  return out
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

function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
