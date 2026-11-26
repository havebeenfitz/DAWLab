/**
 * What collaborators saved in shared folders, as a list of notices. Pure: the
 * watcher feeds it what the hub says, it decides what is new, what to show and
 * what is already read. Nothing here touches the disk or the network.
 */

export interface VersionNotice {
  /** `<hub project id>:<commit id>`: one notice per version, ever. */
  id: string
  folderId: string
  folderName: string
  hubProjectId: string
  projectName: string
  commitId: string
  author: string
  message: string
  branch: string
  /** Saved on a parallel version (someone's own line next to yours). */
  parallel: boolean
  /** When the version was saved (ISO). */
  at: string
  read: boolean
  /** What changed in the project, in words, once the version is on this Mac (e.g. "Marker “Intro” added at bar 1"). */
  summary?: string
}

export interface ProjectCursor {
  /** The hub's "last written" stamp when this project was last read. */
  updatedAt?: string
  /** Every version id already known, so none is announced twice. */
  seen: string[]
}

export type SoundChoice = 'rooster' | 'system' | 'none' | 'custom'
export const SOUND_CHOICES: SoundChoice[] = ['rooster', 'system', 'none', 'custom']
/** Sound files macOS can play. */
export const SOUND_EXTENSIONS = ['wav', 'aif', 'aiff', 'mp3', 'm4a', 'caf']

export interface FeedState {
  enabled: boolean
  /** What a notification sounds like. */
  sound: SoundChoice
  /** The file played for 'custom'. */
  soundFile?: string
  /** Shared folders whose new versions raise no notification. */
  muted: string[]
  /** Per hub project id. */
  cursors: Record<string, ProjectCursor>
  /** Newest first. */
  notices: VersionNotice[]
}

export const MAX_NOTICES = 100

export const emptyFeed = (): FeedState => ({ enabled: true, sound: 'rooster', muted: [], cursors: {}, notices: [] })

interface LogLike {
  branches?: Array<{ name?: string; forkOf?: unknown; commits?: Array<{ commit_id?: unknown; author?: unknown; message?: unknown; timestamp?: unknown }> }>
}

/** "20261125171150" or an ISO string → ISO; anything else → now. */
export function versionTime(stamp: unknown, now: Date): string {
  const s = String(stamp ?? '')
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString()
  const t = Date.parse(s)
  return Number.isNaN(t) ? now.toISOString() : new Date(t).toISOString()
}

export interface ProjectRef { folderId: string; folderName: string; hubProjectId: string; projectName: string }

/**
 * The versions in `log` nobody announced yet, saved by someone other than `me`.
 * The first time a project is seen, everything in it counts as known: joining a
 * folder never floods you with its whole history.
 */
export function readProject(
  cursor: ProjectCursor | undefined, log: LogLike, ref: ProjectRef, me: string, updatedAt: string | undefined, now: Date,
): { cursor: ProjectCursor; notices: VersionNotice[] } {
  const known = new Set(cursor?.seen ?? [])
  const notices: VersionNotice[] = []
  const ids: string[] = []
  for (const b of log.branches ?? []) {
    for (const c of b.commits ?? []) {
      const commitId = String(c.commit_id ?? '')
      if (!commitId || ids.includes(commitId)) continue
      ids.push(commitId)
      if (!cursor || known.has(commitId)) continue
      const author = String(c.author ?? '')
      if (!author || author === me) continue
      notices.push({
        id: `${ref.hubProjectId}:${commitId}`,
        ...ref,
        commitId,
        author,
        message: String(c.message ?? ''),
        branch: String(b.name ?? ''),
        parallel: !!b.forkOf,
        at: versionTime(c.timestamp, now),
        read: false,
      })
    }
  }
  notices.sort((a, b) => b.at.localeCompare(a.at))
  return { cursor: { updatedAt, seen: ids }, notices }
}

/** Adds new notices (newest first), skipping any already listed, keeping the newest MAX_NOTICES. */
export function addNotices(state: FeedState, incoming: VersionNotice[]): { state: FeedState; added: VersionNotice[] } {
  const have = new Set(state.notices.map((n) => n.id))
  const added = incoming.filter((n) => !have.has(n.id))
  if (!added.length) return { state, added }
  const notices = [...added, ...state.notices].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTICES)
  return { state: { ...state, notices }, added }
}

/** Marks notices read: all of them, or those of one project. */
export function markRead(state: FeedState, projectName?: string): FeedState {
  return {
    ...state,
    notices: state.notices.map((n) => (n.read || (projectName && n.projectName !== projectName) ? n : { ...n, read: true })),
  }
}

export const unreadCount = (state: FeedState) => state.notices.filter((n) => !n.read).length

export interface Alert {
  title: string
  body: string
  /** What a click opens: the newest of the versions it stands for. */
  target: VersionNotice
}

const quote = (m: string) => `“${m.trim() || 'Untitled version'}”`

/**
 * The macOS notifications for a batch of new versions: one per version when
 * there's one, otherwise one per shared folder ("3 new versions in Chigura").
 * Muted folders and a switched-off feed raise none.
 */
export function alertsFor(state: FeedState, added: VersionNotice[]): Alert[] {
  if (!state.enabled) return []
  const loud = added.filter((n) => !state.muted.includes(n.folderId))
  const byFolder = new Map<string, VersionNotice[]>()
  for (const n of loud) byFolder.set(n.folderId, [...(byFolder.get(n.folderId) ?? []), n])
  return [...byFolder.values()].map((list) => {
    const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at))
    const newest = sorted[0]
    if (sorted.length === 1) {
      return {
        title: `${newest.author} saved ${newest.parallel ? 'a parallel version' : 'a version'}`,
        body: `${quote(newest.message)} in ${newest.projectName} · ${newest.folderName}${newest.summary ? `\n${newest.summary}` : ''}`,
        target: newest,
      }
    }
    const authors = [...new Set(sorted.map((n) => n.author))]
    const projects = [...new Set(sorted.map((n) => n.projectName))]
    return {
      title: `${sorted.length} new versions in ${newest.folderName}`,
      body: `${authors.join(', ')} · ${projects.slice(0, 3).join(', ')}${projects.length > 3 ? ` and ${projects.length - 3} more` : ''} · newest ${quote(newest.message)}`,
      target: newest,
    }
  })
}

/** Turns a folder's notifications off or on again. */
export function setMuted(state: FeedState, folderId: string, muted: boolean): FeedState {
  const rest = state.muted.filter((id) => id !== folderId)
  return { ...state, muted: muted ? [...rest, folderId] : rest }
}

/** Reads a stored feed, keeping only well-formed parts. */
export function parseFeed(raw: unknown): FeedState {
  const base = emptyFeed()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const cursors: Record<string, ProjectCursor> = {}
  if (r.cursors && typeof r.cursors === 'object') {
    for (const [id, c] of Object.entries(r.cursors as Record<string, any>)) {
      if (c && Array.isArray(c.seen)) cursors[id] = { updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : undefined, seen: c.seen.map(String) }
    }
  }
  const notices = Array.isArray(r.notices)
    ? (r.notices as any[]).filter((n) => n && typeof n.id === 'string' && typeof n.commitId === 'string' && typeof n.projectName === 'string')
    : []
  const sound = SOUND_CHOICES.includes(r.sound as SoundChoice) ? (r.sound as SoundChoice) : base.sound
  const soundFile = typeof r.soundFile === 'string' && r.soundFile ? r.soundFile : undefined
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled,
    sound: sound === 'custom' && !soundFile ? base.sound : sound,
    ...(soundFile ? { soundFile } : {}),
    muted: Array.isArray(r.muted) ? (r.muted as unknown[]).map(String) : [],
    cursors,
    notices: notices.slice(0, MAX_NOTICES) as VersionNotice[],
  }
}

export interface SoundPlan {
  /** Ask macOS to stay quiet: DAWLab plays the sound itself, or there is none. */
  silent: boolean
  /** What DAWLab plays: the built-in rooster, a file, or nothing. */
  play: { kind: 'rooster' } | { kind: 'file'; path: string } | null
}

/** How a batch of notifications sounds: once per batch, whatever the number of versions. */
export function soundPlan(state: Pick<FeedState, 'sound' | 'soundFile'>, alerts: number): SoundPlan {
  if (alerts === 0 || state.sound === 'none') return { silent: true, play: null }
  if (state.sound === 'system') return { silent: false, play: null }
  if (state.sound === 'custom' && state.soundFile) return { silent: true, play: { kind: 'file', path: state.soundFile } }
  return { silent: true, play: { kind: 'rooster' } }
}

/** Picks a sound; a custom one needs a sound file macOS can play. */
export function setSound(state: FeedState, sound: unknown, file?: unknown): FeedState {
  if (!SOUND_CHOICES.includes(sound as SoundChoice)) throw new Error('Unknown sound.')
  if (sound !== 'custom') return { ...state, sound: sound as SoundChoice }
  const f = typeof file === 'string' ? file : state.soundFile
  const ext = (f ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (!f || !SOUND_EXTENSIONS.includes(ext)) throw new Error('Choose a sound file (WAV, AIFF, MP3, M4A or CAF).')
  return { ...state, sound: 'custom', soundFile: f }
}

/** Adds what changed to the notices it knows a summary for; the rest stay as they are. */
export function withSummaries(state: FeedState, summaries: Map<string, string>): FeedState {
  if (summaries.size === 0) return state
  return { ...state, notices: state.notices.map((n) => (summaries.has(n.id) && !n.summary ? { ...n, summary: summaries.get(n.id) } : n)) }
}
