/**
 * Listens to the hub instead of asking it: one event stream per shared folder
 * (GET /api/space/events, see docs/hub-spaces.md). The hub writes an event
 * only when another member changes the folder, so DAWLab fetches only then.
 *
 * A dropped stream reconnects with growing, jittered waits; once it is back,
 * `onOpen` lets the caller catch up on what happened while it was down. A
 * stream that has been silent for longer than two heartbeats is treated as
 * dead. No timers run while a stream is healthy.
 */
import type { HubEvent } from '../../shared/hub-protocol'

export interface EventTarget { folderId: string; hubUrl: string; token: string }

export interface HubEventsDeps {
  /** Shared folders this Mac still has access to. */
  targets: () => EventTarget[]
  /** Another member changed the folder. */
  onChange: (folderId: string, event: HubEvent) => void
  /** The stream is open; `first` is false after a reconnect, when something may have been missed. */
  onOpen: (folderId: string, first: boolean) => void
  /** The hub ended access (removed from the folder, or it was deleted), or doesn't know the token. */
  onGone: (folderId: string) => void
  fetch?: typeof fetch
  random?: () => number
}

export const RETRY_MIN_MS = 2_000
export const RETRY_MAX_MS = 5 * 60_000
/** After the hub said "no such member": the folder's sync marks access closed, this is only a slow safety net. */
export const GONE_RETRY_MS = 60 * 60_000
/** The hub sends a heartbeat every 50 s; nothing for this long means the connection is dead. */
export const STALL_MS = 120_000
/** A stream that stayed up this long resets the backoff. */
const STABLE_MS = 60_000
const MAX_BUFFER = 64 * 1024

/** One SSE block (the lines between blank lines): its event name and data, or null for comments. */
export function parseEventBlock(block: string): { event: string; data: string } | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const i = line.indexOf(':')
    const field = i < 0 ? line : line.slice(0, i)
    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length || event !== 'message' ? { event, data: data.join('\n') } : null
}

const KINDS = new Set<HubEvent['kind']>(['versions', 'projects', 'space'])

function parseChange(data: string): HubEvent | null {
  try {
    const v = JSON.parse(data)
    if (!v || !KINDS.has(v.kind)) return null
    return {
      kind: v.kind,
      ...(typeof v.projectId === 'string' ? { projectId: v.projectId } : {}),
      ...(typeof v.by === 'string' ? { by: v.by } : {}),
    }
  } catch {
    return null
  }
}

type Outcome = 'ended' | 'gone' | 'error'

interface Conn {
  key: string
  stopped: boolean
  freshStart: boolean
  abort?: () => void
  wake?: () => void
}

export function createHubEvents(deps: HubEventsDeps) {
  const doFetch = deps.fetch ?? fetch
  const random = deps.random ?? Math.random
  const conns = new Map<string, Conn>()

  async function stream(conn: Conn, t: EventTarget, opened: () => void): Promise<Outcome> {
    const ctrl = new AbortController()
    conn.abort = () => ctrl.abort()
    let stall = setTimeout(() => ctrl.abort(), STALL_MS)
    const alive = () => {
      clearTimeout(stall)
      stall = setTimeout(() => ctrl.abort(), STALL_MS)
    }
    try {
      const res = await doFetch(`${t.hubUrl}/api/space/events`, {
        headers: { 'X-Hub-Token': t.token, Accept: 'text/event-stream' },
        signal: ctrl.signal,
      })
      if (res.status === 404) {
        await res.body?.cancel().catch(() => {})
        return 'gone'
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => {})
        return 'error'
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      let closed = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done || conn.stopped) return closed ? 'gone' : 'ended'
        alive()
        buf += value.replace(/\r/g, '')
        if (buf.length > MAX_BUFFER) return 'error'
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const msg = parseEventBlock(buf.slice(0, i))
          buf = buf.slice(i + 2)
          if (!msg) continue
          if (msg.event === 'hello') opened()
          else if (msg.event === 'closed') closed = true
          else if (msg.event === 'change') {
            const change = parseChange(msg.data)
            if (change) deps.onChange(t.folderId, change)
          }
        }
      }
    } catch {
      return 'error'
    } finally {
      clearTimeout(stall)
      ctrl.abort()
      conn.abort = undefined
    }
  }

  const sleep = (conn: Conn, ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      conn.wake = undefined
      resolve()
    }
    conn.wake = done
  })

  async function run(conn: Conn, t: EventTarget) {
    let attempt = 0
    let first = true
    while (!conn.stopped) {
      const started = Date.now()
      const outcome = await stream(conn, t, () => {
        deps.onOpen(t.folderId, first)
        first = false
      })
      if (conn.stopped) return
      if (outcome === 'gone') deps.onGone(t.folderId)
      if (conn.freshStart || Date.now() - started > STABLE_MS) attempt = 0
      conn.freshStart = false
      const wait = outcome === 'gone' ? GONE_RETRY_MS : Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt++)
      await sleep(conn, wait * (0.5 + random() / 2))
    }
  }

  function stopConn(folderId: string) {
    const conn = conns.get(folderId)
    if (!conn) return
    conn.stopped = true
    conn.abort?.()
    conn.wake?.()
    conns.delete(folderId)
  }

  return {
    /** Opens streams for new shared folders and closes those that went away or changed hub or token. */
    reconcile() {
      const wanted = new Map(deps.targets().map((t) => [t.folderId, t]))
      for (const [folderId, conn] of conns) {
        const t = wanted.get(folderId)
        if (!t || `${t.hubUrl}|${t.token}` !== conn.key) stopConn(folderId)
      }
      for (const [folderId, t] of wanted) {
        if (conns.has(folderId)) continue
        const conn: Conn = { key: `${t.hubUrl}|${t.token}`, stopped: false, freshStart: false }
        conns.set(folderId, conn)
        void run(conn, t)
      }
    },
    /** After the Mac wakes or the network comes back: reconnect now instead of waiting out a backoff. */
    reconnectAll() {
      for (const conn of conns.values()) {
        conn.freshStart = true
        if (conn.abort) conn.abort()
        else conn.wake?.()
      }
    },
    stop() {
      for (const folderId of [...conns.keys()]) stopConn(folderId)
    },
    /** Folders with a stream (open or reconnecting), for tests. */
    folders: () => [...conns.keys()],
  }
}

export type HubEvents = ReturnType<typeof createHubEvents>
