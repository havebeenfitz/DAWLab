/**
 * Parallel versions. A DAW project can't be merged line by line, so when two
 * people save on top of the same version, the hub keeps the first one on the
 * alternative they were on and moves the second (and anything saved on top of
 * it) into a new alternative named after its author. Nothing is lost, the
 * main line stays a single line, and every Mac ends up with the same history.
 *
 * Versions saved before parents were recorded have no `parent` and are always
 * treated as a straight line. Dependency-free: used by the hub and the app.
 */
import type { ForkDismissal, ForkInfo, SharedBranch, SharedCommit, SharedLog } from './hub-protocol'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "bob · 25 Nov" from a version timestamp (YYYYMMDDHHMMSS) or ISO date; prefixed with the alternative when it isn't main. */
export function forkBranchName(author: string, timestamp: string, onBranch: string): string {
  const digits = String(timestamp).replace(/\D/g, '')
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  const date = month >= 1 && month <= 12 && day >= 1 ? `${day} ${MONTHS[month - 1]}` : ''
  const who = String(author || 'someone').trim() || 'someone'
  const base = [who, date].filter(Boolean).join(' · ')
  return onBranch === 'main' ? base : `${onBranch} · ${base}`
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`
}

/**
 * Decides where the versions in `incoming` that the hub doesn't have yet go.
 * Returns `incoming` with diverging versions moved into fork alternatives;
 * feed the result to mergeLogs. Versions the hub already has keep their place.
 */
export function placeIncoming(current: SharedLog, incoming: SharedLog): SharedLog {
  const known = new Set<string>()
  for (const b of current.branches ?? []) for (const c of b.commits ?? []) known.add(String(c.commit_id))
  const taken = new Set([...(current.branches ?? []), ...(incoming.branches ?? [])].map((b) => b.name))

  const forkOfCommit = new Map<string, string>() // commit id -> fork alternative it went to
  const forks = new Map<string, SharedBranch>()
  const kept: SharedBranch[] = []

  for (const inBranch of incoming.branches ?? []) {
    const onHub = (current.branches ?? []).find((b) => b.name === inBranch.name)
    const stay: SharedCommit[] = []
    const fresh = [...(inBranch.commits ?? [])].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    for (const c of fresh) {
      const id = String(c.commit_id)
      if (known.has(id)) { stay.push(c); continue }
      const parent = c.parent ? String(c.parent) : undefined
      const followsFork = parent ? forkOfCommit.get(parent) : undefined
      // Someone else already saved on top of the same version on this alternative. Going back to
      // an older version of your own and saving again is your choice and stays where it is.
      const diverged = !followsFork && parent && onHub?.commits.some(
        (other) => String(other.parent ?? '') === parent && String(other.commit_id) !== id && other.author !== c.author,
      )
      if (followsFork || diverged) {
        let forkName = followsFork
        if (!forkName) {
          forkName = uniqueName(forkBranchName(c.author, c.timestamp, inBranch.name), taken)
          taken.add(forkName)
          const forkOf: ForkInfo = { branch: inBranch.name, parent: parent!, author: String(c.author ?? '') }
          forks.set(forkName, { name: forkName, commits: [], forkOf })
        }
        forks.get(forkName)!.commits.push(c)
        forkOfCommit.set(id, forkName)
      } else {
        stay.push(c)
      }
    }
    kept.push({ ...inBranch, commits: stay })
  }
  return { ...incoming, branches: [...kept, ...forks.values()] }
}

export interface ParallelPlacement {
  /** Your version that went into a parallel alternative. */
  commitId: string
  message: string
  /** The alternative you saved it on, and the parallel one it is in now. */
  from: string
  fork: string
  /** What someone else saved on the same version meanwhile, if the hub has it. */
  meanwhile?: { message: string; author: string }
}

/**
 * Versions of yours that a sync is about to move into a parallel alternative
 * (saved on `from` locally, in a fork on the hub), so the app can say so.
 */
export function placementMoves(local: { branches?: any[] }, hub: SharedLog): ParallelPlacement[] {
  const hubBranch = new Map<string, SharedBranch>()
  const placeOnHub = new Map<string, string>()
  for (const b of hub.branches ?? []) {
    hubBranch.set(b.name, b)
    for (const c of b.commits ?? []) placeOnHub.set(String(c.commit_id), b.name)
  }
  const out: ParallelPlacement[] = []
  for (const b of local.branches ?? []) {
    for (const c of b.commits ?? []) {
      const there = placeOnHub.get(String(c.commit_id))
      const fork = there ? hubBranch.get(there) : undefined
      if (!there || there === b.name || !fork?.forkOf) continue
      const other = hubBranch.get(fork.forkOf.branch)?.commits.find(
        (o) => String(o.parent ?? '') === fork.forkOf!.parent && o.author !== c.author,
      )
      out.push({
        commitId: String(c.commit_id), message: String(c.message ?? ''), from: b.name, fork: there,
        ...(other ? { meanwhile: { message: String(other.message ?? ''), author: String(other.author ?? '') } } : {}),
      })
    }
  }
  return out
}

/** "Saved as a parallel version in ‘bob · 25 Nov’ because ‘conflict’ was saved meanwhile." */
export function describePlacement(p: ParallelPlacement): string {
  const why = p.meanwhile ? ` because ${p.meanwhile.author ? `${p.meanwhile.author} saved ` : ''}‘${p.meanwhile.message}’ on ${p.from} meanwhile` : ''
  return `“${p.message}” was saved as a parallel version in ‘${p.fork}’${why}. Nothing was lost: switch alternatives with ⌘K, and ${p.from} shows it as a parallel version.`
}

/**
 * After a sync: put local versions where the hub put them (a version of yours
 * that went into a fork alternative leaves the alternative you saved it on),
 * and follow it there if it is the version you have checked out.
 */
export function adoptHubPlacement<T extends { branches?: any[]; current_branch?: string; lastCheckout?: { commitId?: string } | null }>(
  local: T,
  hub: SharedLog,
): T {
  const placeOnHub = new Map<string, string>()
  for (const b of hub.branches ?? []) for (const c of b.commits ?? []) placeOnHub.set(String(c.commit_id), b.name)
  const branches = (local.branches ?? []).map((b: any) => ({
    ...b,
    commits: (b.commits ?? []).filter((c: any) => {
      const there = placeOnHub.get(String(c.commit_id))
      return there === undefined || there === b.name
    }),
  }))
  const checkedOut = local.lastCheckout?.commitId ? placeOnHub.get(String(local.lastCheckout.commitId)) : undefined
  const followBranch = checkedOut && checkedOut !== local.current_branch ? { current_branch: checkedOut } : {}
  return { ...local, branches, ...followBranch }
}

export interface ParallelVersion {
  /** The fork alternative. */
  branch: string
  author: string
  /** Its newest version. */
  tip: SharedCommit
  /** The alternative it split from, and the version both saved on top of. */
  from: string
  parent: string
}

/** Fork alternatives that split from `branch` and haven't been made main yet. */
export function openParallelVersions(log: { branches?: any[] }, branch: string, viewer?: string): ParallelVersion[] {
  const adopted = new Set<string>()
  for (const b of log.branches ?? []) for (const c of b.commits ?? []) if (c.merged_from) adopted.add(String(c.merged_from))
  const out: ParallelVersion[] = []
  for (const b of log.branches ?? []) {
    if (!b.forkOf || b.forkOf.branch !== branch || !b.commits?.length) continue
    const commits = [...b.commits].sort((x: any, y: any) => String(x.timestamp).localeCompare(String(y.timestamp)))
    const tip = commits[commits.length - 1]
    if (commits.some((c: any) => adopted.has(String(c.commit_id)))) continue
    // Dismissed by you for this very version; a newer version in it brings the notice back.
    if (viewer && dismissalOf(b, String(tip.commit_id), viewer)) continue
    out.push({ branch: b.name, author: b.forkOf.author, tip, from: b.forkOf.branch, parent: b.forkOf.parent })
  }
  return out
}

/** The dismissal of `tip` in fork alternative `branch` (by `by`, or by anyone), if there is one. */
export function dismissalOf(branch: { dismissed?: ForkDismissal[] } | undefined, tip: string, by?: string): ForkDismissal | null {
  const list = (branch?.dismissed ?? []).filter((d) => d.tip === tip && (!by || d.by === by))
  return list.length ? list[list.length - 1] : null
}

