// @vitest-environment node
/** The app side of change events, against a real in-process hub. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHub } from '../../../server/src/app.ts'
import { FsStorage } from '../../../server/src/storage.ts'
import type { HubEvent, JoinResponse } from '../../../shared/hub-protocol'
import { createHubEvents, parseEventBlock, type HubEvents } from '../hub-events'

const KEY = 'test-hub-key-123456'
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-hub-events-'))
let hub: ReturnType<typeof createHub>
let server: http.Server
let base = ''
let events: HubEvents | null = null

async function post(p: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return res.json()
}

async function folder() {
  const owner: JoinResponse = await post('/api/spaces', { name: 'Band', memberName: 'Alice' }, { 'X-Hub-Key': KEY })
  const inv = await post('/api/space/invites', { role: 'edit' }, { 'X-Hub-Token': owner.token })
  const editor: JoinResponse = await post('/api/join', { code: inv.code, memberName: 'Bob' })
  return { owner, editor }
}

async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeAll(async () => {
  hub = createHub({ storage: new FsStorage(dataDir), createKey: KEY })
  server = http.createServer(hub)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => {
  events?.stop()
  events = null
})

afterAll(async () => {
  hub.shutdown()
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('parseEventBlock', () => {
  it('reads event and data, and skips heartbeats', () => {
    expect(parseEventBlock(':')).toBeNull()
    expect(parseEventBlock('event: change\ndata: {"kind":"space"}')).toEqual({ event: 'change', data: '{"kind":"space"}' })
    expect(parseEventBlock('data:a\ndata: b')).toEqual({ event: 'message', data: 'a\nb' })
  })
})

describe('hub events', () => {
  it('opens a stream per shared folder and reports what other members change', async () => {
    const { owner, editor } = await folder()
    const opened: string[] = []
    const changes: Array<[string, HubEvent]> = []
    events = createHubEvents({
      targets: () => [{ folderId: 'f1', hubUrl: base, token: owner.token }],
      onOpen: (id) => opened.push(id),
      onChange: (id, e) => changes.push([id, e]),
      onGone: () => {},
    })
    events.reconcile()
    await until(() => opened.length === 1)

    await post('/api/space/projects', { log: { name: 'Song', daw: 'Ableton Live' } }, { 'X-Hub-Token': editor.token })
    await until(() => changes.length === 1)
    expect(changes[0]).toEqual(['f1', { kind: 'projects', by: editor.me.id }])
  })

  it('reports a removed member as gone and stops when the folder goes away', async () => {
    const { owner, editor } = await folder()
    const gone: string[] = []
    let opened = 0
    let targets = [{ folderId: 'f2', hubUrl: base, token: editor.token }]
    events = createHubEvents({
      targets: () => targets,
      onOpen: () => { opened++ },
      onChange: () => {},
      onGone: (id) => gone.push(id),
    })
    events.reconcile()
    await until(() => opened === 1)
    await fetch(`${base}/api/space/members/${editor.me.id}`, { method: 'DELETE', headers: { 'X-Hub-Token': owner.token } })
    await until(() => gone.length === 1)
    expect(gone).toEqual(['f2'])
    targets = []
    events.reconcile()
    expect(events.folders()).toEqual([])
  })

  it('reconnects after the hub drops the stream, and says it was not the first open', async () => {
    const { owner } = await folder()
    const opens: boolean[] = []
    events = createHubEvents({
      targets: () => [{ folderId: 'f3', hubUrl: base, token: owner.token }],
      onOpen: (_id, first) => opens.push(first),
      onChange: () => {},
      onGone: () => {},
      random: () => 0,
    })
    events.reconcile()
    await until(() => opens.length === 1)
    server.closeAllConnections()
    await until(() => opens.length === 2, 5000)
    expect(opens).toEqual([true, false])
  })
})
