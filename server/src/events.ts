/**
 * Server-sent events for shared folders: GET /api/space/events.
 *
 * Each DAWLab keeps one stream open per shared folder, authenticated with its
 * member token like every other /api/space call. When someone changes the
 * folder (saves a version, adds, renames or deletes a project, renames the
 * folder, changes members) the hub writes one small event to every other open
 * stream of that folder, and the apps fetch only then. Nothing is polled.
 *
 * Idle cost: a 3 byte comment line every HEARTBEAT_MS, so proxies and NAT keep
 * the connection open and clients can tell a dead one from a quiet one.
 * Streams of a removed member, or of a deleted folder, are closed at once.
 */
import http from 'node:http'
import type { HubEvent } from '../../shared/hub-protocol.ts'

export const HEARTBEAT_MS = 50_000
/** Open streams per member token; the oldest is closed when one more arrives. */
const MAX_STREAMS_PER_MEMBER = 3

interface Stream {
  memberId: string
  res: http.ServerResponse
}

export function createEventBus(heartbeatMs = HEARTBEAT_MS) {
  const bySpace = new Map<string, Set<Stream>>()

  const end = (spaceId: string, s: Stream) => {
    const set = bySpace.get(spaceId)
    if (!set?.delete(s)) return
    if (!set.size) bySpace.delete(spaceId)
    if (!s.res.writableEnded) s.res.end()
  }

  const write = (spaceId: string, s: Stream, chunk: string) => {
    if (s.res.destroyed || s.res.writableEnded) return end(spaceId, s)
    s.res.write(chunk)
  }

  const timer = setInterval(() => {
    for (const [spaceId, set] of bySpace) for (const s of set) write(spaceId, s, ':\n\n')
  }, heartbeatMs)
  timer.unref()

  return {
    /** Opens a stream for an authenticated member. Resolves when the client goes away or the stream is closed. */
    open(spaceId: string, memberId: string, req: http.IncomingMessage, res: http.ServerResponse) {
      const set = bySpace.get(spaceId) ?? new Set<Stream>()
      bySpace.set(spaceId, set)
      const mine = [...set].filter((s) => s.memberId === memberId)
      for (const old of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_MEMBER + 1))) end(spaceId, old)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      })
      req.socket.setNoDelay(true)
      req.socket.setKeepAlive(true, heartbeatMs)
      const stream: Stream = { memberId, res }
      set.add(stream)
      write(spaceId, stream, `event: hello\ndata: {}\n\n`)
      return new Promise<void>((resolve) => {
        res.on('close', () => { end(spaceId, stream); resolve() })
      })
    },

    /** Tells everyone in the folder except the member who made the change. */
    publish(spaceId: string, event: HubEvent) {
      const set = bySpace.get(spaceId)
      if (!set) return
      const chunk = `event: change\ndata: ${JSON.stringify(event)}\n\n`
      for (const s of [...set]) if (s.memberId !== event.by) write(spaceId, s, chunk)
    },

    /** Closes the streams of one member (removed or left) or of the whole folder (deleted). */
    close(spaceId: string, memberId?: string) {
      const set = bySpace.get(spaceId)
      if (!set) return
      for (const s of [...set]) {
        if (memberId && s.memberId !== memberId) continue
        write(spaceId, s, `event: closed\ndata: {}\n\n`)
        end(spaceId, s)
      }
    },

    /** Ends every stream, so the server can shut down. */
    shutdown() {
      clearInterval(timer)
      for (const [spaceId, set] of bySpace) for (const s of [...set]) end(spaceId, s)
    },

    count: (spaceId: string) => bySpace.get(spaceId)?.size ?? 0,
  }
}

export type EventBus = ReturnType<typeof createEventBus>
