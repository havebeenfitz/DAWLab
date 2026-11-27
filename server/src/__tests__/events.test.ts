// @vitest-environment node
/** Change events of shared folders (GET /api/space/events) against a real in-process hub. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createHub } from '../app.ts'
import { FsStorage } from '../storage.ts'
import type { JoinResponse } from '../../../shared/hub-protocol.ts'

const KEY = 'test-hub-key-123456'
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-events-'))
let hub: ReturnType<typeof createHub>
let server: http.Server
let base = ''
let ip = 0

async function call(method: string, p: string, token?: string, body?: unknown, raw?: string) {
  const headers: Record<string, string> = { 'X-Forwarded-For': `10.9.0.${++ip % 250}` }
  if (token) headers['X-Hub-Token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${base}${p}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

/** An open event stream that collects what it receives. */
async function listen(token: string) {
  const ctrl = new AbortController()
  const res = await fetch(`${base}/api/space/events`, { headers: { 'X-Hub-Token': token }, signal: ctrl.signal })
  const received: string[] = []
  let ended = false
  let notify = () => {}
  if (res.ok && res.body) {
    void (async () => {
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          let i: number
          while ((i = buf.indexOf('\n\n')) >= 0) {
            received.push(buf.slice(0, i))
            buf = buf.slice(i + 2)
          }
          notify()
        }
      } catch { /* aborted */ }
      ended = true
      notify()
    })()
  }
  const until = async (ok: () => boolean, ms = 2000) => {
    const end = Date.now() + ms
    while (!ok()) {
      if (Date.now() > end) throw new Error(`timed out; got ${JSON.stringify(received)}`)
      await new Promise<void>((r) => { notify = r; setTimeout(r, 20) })
    }
  }
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    received,
    changes: () => received.filter((b) => b.startsWith('event: change')).map((b) => JSON.parse(b.split('data: ')[1])),
    ended: () => ended,
    until,
    close: () => ctrl.abort(),
  }
}

async function space(): Promise<{ owner: JoinResponse; editor: JoinResponse }> {
  const owner = await fetch(`${base}/api/spaces`, {
    method: 'POST', headers: { 'X-Hub-Key': KEY, 'Content-Type': 'application/json', 'X-Forwarded-For': '10.8.0.1' },
    body: JSON.stringify({ name: 'Band', memberName: 'Alice' }),
  }).then((r) => r.json()) as JoinResponse
  const inv = await call('POST', '/api/space/invites', owner.token, { role: 'edit' })
  const editor = (await call('POST', '/api/join', undefined, { code: inv.json.code, memberName: 'Bob' })).json as JoinResponse
  return { owner, editor }
}

beforeAll(async () => {
  hub = createHub({ storage: new FsStorage(dataDir), createKey: KEY, heartbeatMs: 100 })
  server = http.createServer(hub)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  hub.shutdown()
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('space events', () => {
  it('needs a member token: anything else is the hidden 404', async () => {
    const s = await listen('x'.repeat(32))
    expect(s.status).toBe(404)
    const none = await fetch(`${base}/api/space/events`)
    expect(none.status).toBe(404)
    expect(await none.text()).toBe('')
  })

  it('says hello, sends heartbeats, and tells others (not the author) about new projects, versions and renames', async () => {
    const { owner, editor } = await space()
    const ownerStream = await listen(owner.token)
    const editorStream = await listen(editor.token)
    expect(ownerStream.status).toBe(200)
    expect(ownerStream.contentType).toMatch(/^text\/event-stream/)
    await ownerStream.until(() => ownerStream.received.some((b) => b.startsWith('event: hello')))
    await ownerStream.until(() => ownerStream.received.includes(':'))

    const add = await call('POST', '/api/space/projects', editor.token, { log: { name: 'Song', daw: 'Ableton Live' } })
    const projectId = add.json.project.id
    await ownerStream.until(() => ownerStream.changes().length === 1)
    expect(ownerStream.changes()[0]).toEqual({ kind: 'projects', by: editor.me.id })

    const file = 'ableton data'
    const hash = crypto.createHash('sha256').update(file).digest('hex')
    const p = `/api/space/projects/${projectId}`
    await call('PUT', `${p}/objects/${hash}`, editor.token, undefined, file)
    await call('PUT', `${p}/commits/c1/filemap`, editor.token, [{ path: 'Song.als', hash }])
    const log = { name: 'Song', daw: 'Ableton Live', branches: [{ name: 'main', commits: [{ commit_id: 'c1', timestamp: '1', message: 'v1', author: 'Bob' }] }] }
    expect((await call('PUT', `${p}/log`, editor.token, log)).status).toBe(200)
    await ownerStream.until(() => ownerStream.changes().length === 2)
    // Uploading files and filemaps is not an event; only the log write is.
    expect(ownerStream.changes()[1]).toEqual({ kind: 'versions', projectId, by: editor.me.id })

    // Syncs send their log every time; one that brings nothing new is not an event, or apps would wake each other forever.
    expect((await call('PUT', `${p}/log`, editor.token, log)).status).toBe(200)
    const meta = (await call('GET', '/api/space', owner.token)).json.projects.find((x: any) => x.id === projectId)
    expect((await call('PUT', `${p}/log`, owner.token, (await call('GET', p, owner.token)).json.log)).status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    expect(ownerStream.changes()).toHaveLength(2)
    expect(editorStream.changes()).toHaveLength(0)
    expect((await call('GET', '/api/space', owner.token)).json.projects.find((x: any) => x.id === projectId).updatedAt).toBe(meta.updatedAt)

    expect((await call('PATCH', '/api/space', owner.token, { name: 'Band 2' })).status).toBe(200)
    await editorStream.until(() => editorStream.changes().length === 1)
    expect(editorStream.changes()[0]).toEqual({ kind: 'space', by: owner.me.id })
    // The author never hears about their own changes.
    expect(editorStream.changes().filter((c) => c.by === editor.me.id)).toEqual([])
    expect(ownerStream.changes().filter((c) => c.by === owner.me.id)).toEqual([])

    // A failed write is not an event.
    expect((await call('PATCH', '/api/space', editor.token, { name: 'Nope' })).status).toBe(403)
    await new Promise((r) => setTimeout(r, 50))
    expect(ownerStream.changes()).toHaveLength(2)

    ownerStream.close()
    editorStream.close()
  })

  it('closes the stream of a removed member, and every stream when the folder is deleted', async () => {
    const { owner, editor } = await space()
    const ownerStream = await listen(owner.token)
    const editorStream = await listen(editor.token)
    await editorStream.until(() => editorStream.received.length > 0)

    expect((await call('DELETE', `/api/space/members/${editor.me.id}`, owner.token)).status).toBe(204)
    await editorStream.until(() => editorStream.ended())
    expect(editorStream.received.some((b) => b.startsWith('event: closed'))).toBe(true)
    expect((await listen(editor.token)).status).toBe(404)

    expect((await call('DELETE', '/api/space', owner.token)).status).toBe(204)
    await ownerStream.until(() => ownerStream.ended())
  })

  it('keeps at most three streams per member', async () => {
    const { owner } = await space()
    const streams = [] as Awaited<ReturnType<typeof listen>>[]
    for (let i = 0; i < 4; i++) {
      const s = await listen(owner.token)
      await s.until(() => s.received.length > 0)
      streams.push(s)
    }
    await streams[0].until(() => streams[0].ended())
    expect(streams.slice(1).map((s) => s.ended())).toEqual([false, false, false])
    for (const s of streams) s.close()
  })
})
