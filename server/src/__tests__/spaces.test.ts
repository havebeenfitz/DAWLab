// @vitest-environment node
/**
 * Shared folders (spaces) against a real in-process hub on filesystem storage.
 * Contract: docs/hub-spaces.md.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createHub } from '../app.ts'
import { FsStorage } from '../storage.ts'
import type { CreatedInvite, InviteInfo, InvitePreview, JoinResponse, SpaceResponse } from '../../../shared/hub-protocol.ts'

const KEY = 'test-hub-key-123456'
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-spaces-'))
let server: http.Server
let base = ''
let ipCounter = 0
/** Each test gets its own address so the per-IP limiters don't interfere. */
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`

interface Opts { token?: string; key?: string; body?: unknown; raw?: string; ip?: string }
interface Reply { status: number; headers: Headers; text: string; json: any }

async function call(method: string, p: string, o: Opts = {}): Promise<Reply> {
  const headers: Record<string, string> = { 'X-Forwarded-For': o.ip ?? '10.255.0.1' }
  if (o.token) headers['X-Hub-Token'] = o.token
  if (o.key !== undefined) headers['X-Hub-Key'] = o.key
  let body: BodyInit | undefined
  if (o.raw !== undefined) body = o.raw
  else if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(o.body)
  }
  const res = await fetch(`${base}${p}`, { method, headers, body })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json }
}

function expectHidden(r: Reply) {
  expect(r.status).toBe(404)
  expect(r.headers.get('content-length')).toBe('0')
  expect(r.text).toBe('')
}

const sha = (b: string) => crypto.createHash('sha256').update(b).digest('hex')

async function createSpace(name = 'Band', memberName = 'Alice'): Promise<JoinResponse> {
  const r = await call('POST', '/api/spaces', { key: KEY, body: { name, memberName }, ip: freshIp() })
  expect(r.status).toBe(201)
  return r.json
}

async function invite(ownerToken: string, body: Record<string, unknown>): Promise<CreatedInvite> {
  const r = await call('POST', '/api/space/invites', { token: ownerToken, body })
  expect(r.status).toBe(201)
  return r.json
}

async function joinAs(code: string, memberName: string): Promise<JoinResponse> {
  const r = await call('POST', '/api/join', { body: { code, memberName }, ip: freshIp() })
  expect(r.status).toBe(200)
  return r.json
}

/** A space with an owner, an editor and a listener, and one project with one version. */
async function setup() {
  const owner = await createSpace()
  const editor = await joinAs((await invite(owner.token, { role: 'edit' })).code, 'Bob')
  const listener = await joinAs((await invite(owner.token, { role: 'listen' })).code, 'Cara')
  const add = await call('POST', '/api/space/projects', { token: editor.token, body: { log: { name: 'Song', daw: 'Ableton Live' } } })
  expect(add.status).toBe(201)
  const projectId: string = add.json.project.id
  const p = `/api/space/projects/${projectId}`
  const file = 'ableton data', preview = 'RIFF....WAVEpreview'
  for (const content of [file, preview]) {
    expect((await call('PUT', `${p}/objects/${sha(content)}`, { token: editor.token, raw: content })).status).toBe(201)
  }
  expect((await call('PUT', `${p}/commits/c1/filemap`, { token: editor.token, body: [{ path: 'Song.als', hash: sha(file) }] })).status).toBe(200)
  const log = { name: 'Song', daw: 'Ableton Live', branches: [{ name: 'main', commits: [{ commit_id: 'c1', timestamp: '1', message: 'v1', author: 'Bob', preview_file: sha(preview) }] }] }
  expect((await call('PUT', `${p}/log`, { token: editor.token, body: log })).status).toBe(200)
  return { owner, editor, listener, projectId, p, fileHash: sha(file), previewHash: sha(preview), log }
}

beforeAll(async () => {
  server = http.createServer(createHub({ storage: new FsStorage(dataDir), createKey: KEY }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('creating and reading a space', () => {
  it('needs the hub key; a bad key is the hidden 404', async () => {
    expectHidden(await call('POST', '/api/spaces', { key: 'wrong', body: { name: 'X', memberName: 'Y' }, ip: freshIp() }))
    expectHidden(await call('POST', '/api/spaces', { body: { name: 'X', memberName: 'Y' }, ip: freshIp() }))
  })

  it('with a valid key and a blank name answers 400 with an error and creates nothing (test connection)', async () => {
    const before = fs.existsSync(path.join(dataDir, 'spaces')) ? fs.readdirSync(path.join(dataDir, 'spaces')).length : 0
    for (const body of [{ name: '', memberName: 'Y' }, { name: '   ', memberName: 'Y' }, {}]) {
      const r = await call('POST', '/api/spaces', { key: KEY, body, ip: freshIp() })
      expect(r.status).toBe(400)
      expect(typeof r.json.error).toBe('string')
    }
    const after = fs.existsSync(path.join(dataDir, 'spaces')) ? fs.readdirSync(path.join(dataDir, 'spaces')).length : 0
    expect(after).toBe(before)
  })

  it('validates the member name (trimmed, 1-60 chars)', async () => {
    expect((await call('POST', '/api/spaces', { key: KEY, body: { name: 'X', memberName: 'a'.repeat(61) }, ip: freshIp() })).status).toBe(400)
    const ok = await call('POST', '/api/spaces', { key: KEY, body: { name: ' X ', memberName: '  Al  ' }, ip: freshIp() })
    expect(ok.status).toBe(201)
    expect(ok.json.me.name).toBe('Al')
    expect(ok.json.space.name).toBe('X')
  })

  it('returns a token and the owner, and GET /api/space shows the space', async () => {
    const created = await createSpace('Band', 'Alice')
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(created.me).toEqual({ id: expect.any(String), name: 'Alice', role: 'owner' })
    expect(Object.keys(created.space).sort()).toEqual(['createdAt', 'id', 'name'])
    const r = await call('GET', '/api/space', { token: created.token })
    expect(r.status).toBe(200)
    const body: SpaceResponse = r.json
    expect(body.space).toEqual(created.space)
    expect(body.me).toEqual(created.me)
    expect(body.members).toEqual([{ ...created.me, joinedAt: expect.any(String) }])
    expect(body.projects).toEqual([])
  })

  it('renames a space (owner only)', async () => {
    const { owner, editor } = await setup()
    expect((await call('PATCH', '/api/space', { token: editor.token, body: { name: 'Nope' } })).status).toBe(403)
    const r = await call('PATCH', '/api/space', { token: owner.token, body: { name: 'New name' } })
    expect(r.status).toBe(200)
    expect(r.json.space.name).toBe('New name')
  })

  it('lists projects with updatedAt', async () => {
    const { owner, projectId, editor } = await setup()
    const r = await call('GET', '/api/space', { token: owner.token })
    expect(r.json.projects).toEqual([{
      id: projectId, name: 'Song', daw: 'Ableton Live', addedAt: expect.any(String), addedBy: editor.me.id, updatedAt: expect.any(String),
    }])
    expect(r.json.members.map((m: any) => m.role)).toEqual(['owner', 'edit', 'listen'])
  })
})

describe('file sizes for progress', () => {
  it('tells members how big stored files are, null for unknown ones, and ignores junk', async () => {
    const { listener, p, fileHash } = await setup()
    const missing = 'a'.repeat(64)
    const r = await call('POST', `${p}/objects/sizes`, { token: listener.token, body: { hashes: [fileHash, missing, '../x'] } })
    expect(r.status).toBe(200)
    expect(r.json.sizes).toEqual({ [fileHash]: 'ableton data'.length, [missing]: null })
  })

  it('is the hidden 404 for someone who is not a member', async () => {
    const { p, fileHash } = await setup()
    expect((await call('POST', `${p}/objects/sizes`, { token: 'x'.repeat(40), body: { hashes: [fileHash] } })).status).toBe(404)
  })
})

describe('invites', () => {
  it('creates, lists and revokes; the code is never shown again', async () => {
    const owner = await createSpace()
    const inv = await invite(owner.token, { role: 'listen', expiresInDays: 3, maxUses: 2 })
    expect(inv.code).toMatch(/^DAWL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(inv.maxUses).toBe(2)
    expect(Date.parse(inv.expiresAt) - Date.now()).toBeGreaterThan(2.9 * 86400_000)
    const list = await call('GET', '/api/space/invites', { token: owner.token })
    const entries: InviteInfo[] = list.json
    expect(entries).toEqual([{ id: inv.id, role: 'listen', expiresAt: inv.expiresAt, maxUses: 2, uses: 0 }])
    expect(list.text).not.toContain(inv.code.slice(5))
    expect((await call('DELETE', `/api/space/invites/${inv.id}`, { token: owner.token })).status).toBe(204)
    expect((await call('GET', '/api/space/invites', { token: owner.token })).json).toEqual([])
    expectHidden(await call('POST', '/api/join', { body: { code: inv.code, memberName: 'X' }, ip: freshIp() }))
  })

  it('applies defaults and validates', async () => {
    const owner = await createSpace()
    const inv = await invite(owner.token, { role: 'edit' })
    expect(inv.maxUses).toBe(10)
    expect(Math.round((Date.parse(inv.expiresAt) - Date.now()) / 86400_000)).toBe(7)
    for (const body of [{ role: 'owner' }, {}, { role: 'edit', expiresInDays: 31 }, { role: 'edit', expiresInDays: 0 }, { role: 'edit', maxUses: 101 }, { role: 'edit', maxUses: 1.5 }]) {
      const r = await call('POST', '/api/space/invites', { token: owner.token, body })
      expect(r.status).toBe(400)
      expect(r.json.error).toBeTruthy()
    }
  })

  it('joins with a valid code in any spelling and counts uses', async () => {
    const owner = await createSpace()
    const inv = await invite(owner.token, { role: 'edit', maxUses: 3 })
    const sloppy = inv.code.toLowerCase().replace(/-/g, ' ').replace(/1/g, 'l').replace(/0/g, 'o')
    const joined = await joinAs(sloppy, '  Bob ')
    expect(joined.me).toEqual({ id: expect.any(String), name: 'Bob', role: 'edit' })
    expect(joined.space.id).toBe(owner.space.id)
    expect((await call('GET', '/api/space', { token: joined.token })).status).toBe(200)
    expect((await call('GET', '/api/space/invites', { token: owner.token })).json[0].uses).toBe(1)
  })

  it('rejects a bad member name without using up the invite', async () => {
    const owner = await createSpace()
    const inv = await invite(owner.token, { role: 'edit', maxUses: 1 })
    const r = await call('POST', '/api/join', { body: { code: inv.code, memberName: '  ' }, ip: freshIp() })
    expect(r.status).toBe(400)
    expect((await call('GET', '/api/space/invites', { token: owner.token })).json[0].uses).toBe(0)
    await joinAs(inv.code, 'Bob')
  })

  it('used-up, expired and garbage codes are the hidden 404', async () => {
    const owner = await createSpace()
    const once = await invite(owner.token, { role: 'listen', maxUses: 1 })
    await joinAs(once.code, 'First')
    expectHidden(await call('POST', '/api/join', { body: { code: once.code, memberName: 'Second' }, ip: freshIp() }))

    const soon = await invite(owner.token, { role: 'listen', expiresInDays: 1 })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 2 * 86400_000)
      expectHidden(await call('POST', '/api/join', { body: { code: soon.code, memberName: 'Late' }, ip: freshIp() }))
      expectHidden(await call('POST', '/api/invite/peek', { body: { code: soon.code }, ip: freshIp() }))
    } finally {
      vi.useRealTimers()
    }

    for (const body of [{ code: 'DAWL-0000-0000-0000', memberName: 'X' }, { code: 'nonsense', memberName: 'X' }, {}, null, { code: 42 }]) {
      expectHidden(await call('POST', '/api/join', { body, ip: freshIp() }))
    }
    expectHidden(await call('POST', '/api/join', { raw: '{not json', ip: freshIp() }))
  })

  it('rate limits failed joins per address, then hides even valid codes', async () => {
    const owner = await createSpace()
    const inv = await invite(owner.token, { role: 'listen' })
    const ip = freshIp()
    for (let i = 0; i < 10; i++) expectHidden(await call('POST', '/api/join', { body: { code: 'DAWL-ZZZZ-ZZZZ-ZZZZ', memberName: 'X' }, ip }))
    expectHidden(await call('POST', '/api/join', { body: { code: inv.code, memberName: 'X' }, ip }))
    expectHidden(await call('POST', '/api/invite/peek', { body: { code: inv.code }, ip }))
    expect((await call('POST', '/api/join', { body: { code: inv.code, memberName: 'X' }, ip: freshIp() })).status).toBe(200)
  })

  it('peeks at an invite without using it; failed peeks count toward the join limit', async () => {
    const { owner } = await setup()
    const inv = await invite(owner.token, { role: 'edit', maxUses: 1 })
    const r = await call('POST', '/api/invite/peek', { body: { code: inv.code }, ip: freshIp() })
    expect(r.status).toBe(200)
    const preview: InvitePreview = r.json
    expect(preview).toEqual({
      space: { id: owner.space.id, name: 'Band' }, role: 'edit', invitedBy: 'Alice', projectCount: 1, memberCount: 3, expiresAt: inv.expiresAt,
    })
    expect((await call('GET', '/api/space/invites', { token: owner.token })).json.find((i: InviteInfo) => i.id === inv.id).uses).toBe(0)

    const ip = freshIp()
    for (let i = 0; i < 10; i++) expectHidden(await call('POST', '/api/invite/peek', { body: { code: 'DAWL-ZZZZ-ZZZZ-ZZZZ' }, ip }))
    expectHidden(await call('POST', '/api/join', { body: { code: inv.code, memberName: 'X' }, ip }))
  })
})

describe('roles', () => {
  it('listeners read previews and comments only', async () => {
    const { listener, p, fileHash, previewHash, log } = await setup()
    const t = listener.token
    const got = await call('GET', p, { token: t })
    expect(got.status).toBe(200)
    expect(got.json.role).toBe('listen')
    expect((await call('PUT', `${p}/log`, { token: t, body: log })).status).toBe(403)
    expect((await call('GET', `${p}/commits/c1/filemap`, { token: t })).status).toBe(403)
    expect((await call('GET', `${p}/objects/${fileHash}`, { token: t })).status).toBe(403)
    expect((await call('PUT', `${p}/objects/${sha('x')}`, { token: t, raw: 'x' })).status).toBe(403)
    expect((await call('POST', `${p}/objects/missing`, { token: t, body: { hashes: [] } })).status).toBe(403)
    const prev = await call('GET', `${p}/objects/${previewHash}`, { token: t })
    expect(prev.status).toBe(200)
    expect(prev.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await call('GET', `${p}/commits/c1/comments`, { token: t })).status).toBe(200)
    expect((await call('POST', '/api/space/projects', { token: t, body: { log: { name: 'X' } } })).status).toBe(403)
  })

  it('owner and editors read and write; GET maps owner to edit', async () => {
    const { owner, editor, p, fileHash } = await setup()
    for (const t of [owner.token, editor.token]) {
      const r = await call('GET', p, { token: t })
      expect(r.json.role).toBe('edit')
      expect((await call('GET', `${p}/commits/c1/filemap`, { token: t })).json).toEqual([{ path: 'Song.als', hash: fileHash }])
      expect((await call('GET', `${p}/objects/${fileHash}`, { token: t })).text).toBe('ableton data')
    }
  })

  it('editors cannot manage people, invites, projects or the space', async () => {
    const { editor, listener, projectId } = await setup()
    const t = editor.token
    expect((await call('GET', '/api/space/invites', { token: t })).status).toBe(403)
    expect((await call('POST', '/api/space/invites', { token: t, body: { role: 'edit' } })).status).toBe(403)
    expect((await call('PATCH', `/api/space/members/${listener.me.id}`, { token: t, body: { role: 'edit' } })).status).toBe(403)
    expect((await call('DELETE', `/api/space/members/${listener.me.id}`, { token: t })).status).toBe(403)
    expect((await call('DELETE', `/api/space/projects/${projectId}`, { token: t })).status).toBe(403)
    expect((await call('DELETE', '/api/space', { token: t })).status).toBe(403)
  })

  it('role changes and removals take effect immediately', async () => {
    const { owner, listener, editor, p, log } = await setup()
    const up = await call('PATCH', `/api/space/members/${listener.me.id}`, { token: owner.token, body: { role: 'edit' } })
    expect(up.status).toBe(200)
    expect(up.json.member).toEqual({ id: listener.me.id, name: 'Cara', role: 'edit', joinedAt: expect.any(String) })
    expect((await call('PUT', `${p}/log`, { token: listener.token, body: log })).status).toBe(200)
    expect((await call('PATCH', `/api/space/members/${listener.me.id}`, { token: owner.token, body: { role: 'owner' } })).status).toBe(400)
    expect((await call('PATCH', `/api/space/members/${owner.me.id}`, { token: owner.token, body: { role: 'listen' } })).status).toBe(400)

    await call('PATCH', `/api/space/members/${editor.me.id}`, { token: owner.token, body: { role: 'listen' } })
    expect((await call('PUT', `${p}/log`, { token: editor.token, body: log })).status).toBe(403)

    expect((await call('DELETE', `/api/space/members/${editor.me.id}`, { token: owner.token })).status).toBe(204)
    expectHidden(await call('GET', '/api/space', { token: editor.token }))
    expectHidden(await call('GET', p, { token: editor.token }))
    expect((await call('GET', '/api/space', { token: owner.token })).json.members.map((m: any) => m.name)).toEqual(['Alice', 'Cara'])
  })

  it('the owner cannot be removed; members can leave', async () => {
    const { owner, listener } = await setup()
    const r = await call('DELETE', `/api/space/members/${owner.me.id}`, { token: owner.token })
    expect(r.status).toBe(400)
    expect(r.json.error).toBeTruthy()
    expect((await call('DELETE', `/api/space/members/${listener.me.id}`, { token: listener.token })).status).toBe(204)
    expectHidden(await call('GET', '/api/space', { token: listener.token }))
  })

  it('deleting the space kills every token and its invites', async () => {
    const { owner, editor, listener, p } = await setup()
    const inv = await invite(owner.token, { role: 'listen' })
    expect((await call('DELETE', '/api/space', { token: owner.token })).status).toBe(204)
    for (const t of [owner.token, editor.token, listener.token]) {
      expectHidden(await call('GET', '/api/space', { token: t }))
      expectHidden(await call('GET', p, { token: t }))
    }
    expectHidden(await call('POST', '/api/join', { body: { code: inv.code, memberName: 'X' }, ip: freshIp() }))
  })
})

describe('projects in spaces', () => {
  it('a project of another space is the hidden 404', async () => {
    const a = await setup()
    const b = await setup()
    expectHidden(await call('GET', `/api/space/projects/${b.projectId}`, { token: a.owner.token }))
    expectHidden(await call('GET', `/api/space/projects/${b.projectId}/commits/c1/comments`, { token: a.listener.token }))
    expectHidden(await call('DELETE', `/api/space/projects/${b.projectId}`, { token: a.owner.token }))
    expectHidden(await call('GET', '/api/space/projects/not-a-project', { token: a.owner.token }))
  })

  it('member tokens do not work on the legacy routes, nor legacy tokens on spaces', async () => {
    const { owner } = await setup()
    expectHidden(await call('GET', '/api/project', { token: owner.token }))
    const legacy = await call('POST', '/api/projects', { key: KEY, body: { log: { name: 'Old' } }, ip: freshIp() })
    expect(legacy.status).toBe(201)
    expectHidden(await call('GET', '/api/space', { token: legacy.json.editToken }))
    expect((await call('GET', '/api/project', { token: legacy.json.editToken })).status).toBe(200)
  })

  it('the owner removes a project from the space', async () => {
    const { owner, p, projectId } = await setup()
    expect((await call('DELETE', `/api/space/projects/${projectId}`, { token: owner.token })).status).toBe(204)
    expect((await call('GET', '/api/space', { token: owner.token })).json.projects).toEqual([])
    expectHidden(await call('GET', p, { token: owner.token }))
    // Its versions and files are gone from the server's disk too.
    expect(fs.existsSync(path.join(dataDir, 'projects', projectId))).toBe(false)
  })
})

describe('comment authorship', () => {
  const c = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, comment: text, ...extra })

  it('stamps the author, ignores a forged author, and limits edits to the author or owner', async () => {
    const { owner, editor, listener, p } = await setup()
    const url = `${p}/commits/c1/comments`
    const post = (t: string, body: unknown) => call('POST', url, { token: t, body })

    let r = await post(listener.token, [c('a', 'listener says', { authorMemberId: owner.me.id })])
    expect(r.status).toBe(200)
    expect(r.json).toEqual([c('a', 'listener says', { authorMemberId: listener.me.id })])

    await post(editor.token, [c('b', 'editor says')])
    // editor tries to edit listener's comment and reply to it
    r = await post(editor.token, [c('a', 'hacked', { replies: [{ id: 'r1', text: 'reply', authorMemberId: listener.me.id }] })])
    const a = r.json.find((x: any) => x.id === 'a')
    expect(a.comment).toBe('listener says')
    expect(a.authorMemberId).toBe(listener.me.id)
    expect(a.replies).toEqual([{ id: 'r1', text: 'reply', authorMemberId: editor.me.id }])

    // listener edits own comment, can't edit editor's reply
    r = await post(listener.token, [c('a', 'edited by me', { replies: [{ id: 'r1', text: 'changed' }] })])
    const a2 = r.json.find((x: any) => x.id === 'a')
    expect(a2.comment).toBe('edited by me')
    expect(a2.replies[0].text).toBe('reply')

    // editor edits own reply and can't take over the comment's authorship
    r = await post(editor.token, [c('b', 'editor edited', { authorMemberId: listener.me.id })])
    expect(r.json.find((x: any) => x.id === 'b')).toEqual(c('b', 'editor edited', { authorMemberId: editor.me.id }))

    // owner may change any comment and reply; authorship is kept
    r = await post(owner.token, [c('b', 'owner fixed', { deleted: true, replies: [] }), c('a', 'owner fixed a', { replies: [{ id: 'r1', text: 'owner fixed reply' }] })])
    const b = r.json.find((x: any) => x.id === 'b')
    expect(b).toMatchObject({ comment: 'owner fixed', deleted: true, authorMemberId: editor.me.id })
    const a3 = r.json.find((x: any) => x.id === 'a')
    expect(a3).toMatchObject({ comment: 'owner fixed a', authorMemberId: listener.me.id })
    expect(a3.replies).toEqual([{ id: 'r1', text: 'owner fixed reply', authorMemberId: editor.me.id }])
  })
})

describe('hidden 404s', () => {
  it('unknown paths, methods and tokens all look the same', async () => {
    const { owner } = await setup()
    const probes: Array<[string, string, Opts?]> = [
      ['GET', '/'], ['GET', '/s/whatever'], ['GET', '/api/spaces'], ['GET', '/api/join'], ['GET', '/api/invite/peek'],
      ['GET', '/api/space'], ['GET', '/api/space', { token: 'x'.repeat(32) }], ['GET', '/api/space', { token: 'short' }],
      ['GET', '/api/space/nope', { token: owner.token }], ['PUT', '/api/space', { token: owner.token }],
      ['GET', '/api/space/members/x/y', { token: owner.token }], ['POST', '/api/space/projects/x/y/z', { token: owner.token }],
      ['GET', '/api/space/projects', { token: owner.token }], ['GET', '/api/project', { token: 'y'.repeat(32) }],
    ]
    for (const [m, p, o] of probes) expectHidden(await call(m, p, o))
  })
})

describe('server storage', () => {
  it('tells only the owner how much space the server has', async () => {
    const { owner, editor, listener } = await setup()
    const r = await call('GET', '/api/space/storage', { token: owner.token })
    expect(r.status).toBe(200)
    expect(r.json.kind).toBe('fs')
    expect(r.json.totalBytes).toBeGreaterThan(0)
    expect(r.json.freeBytes).toBeGreaterThanOrEqual(0)
    expect(r.json.freeBytes).toBeLessThanOrEqual(r.json.totalBytes)
    expect((await call('GET', '/api/space/storage', { token: editor.token })).status).not.toBe(200)
    expect((await call('GET', '/api/space/storage', { token: listener.token })).status).not.toBe(200)
    expectHidden(await call('GET', '/api/space/storage'))
  })
})
