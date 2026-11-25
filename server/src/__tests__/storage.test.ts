// @vitest-environment node
/** Both storage back ends must behave the same; S3 runs against an in-memory fake of the AWS SDK. */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { FsStorage, S3Storage, storageFromEnv, type Storage } from '../storage.ts'

/** Just enough of @aws-sdk/client-s3 for S3Storage, keeping objects in a Map. */
function fakeS3Sdk() {
  const objects = new Map<string, Buffer>()
  const sent: Array<{ type: string; input: any }> = []
  class Command { input: any; constructor(input: any) { this.input = input } }
  class PutObjectCommand extends Command {}
  class HeadObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  const notFound = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } })
  const toBuffer = async (body: unknown): Promise<Buffer> => {
    if (typeof body === 'string') return Buffer.from(body)
    const chunks: Buffer[] = []
    for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c))
    return Buffer.concat(chunks)
  }
  let clientConfig: any
  class S3Client {
    constructor(config: any) { clientConfig = config }
    async send(cmd: Command) {
      const { Key, Range } = cmd.input
      sent.push({ type: cmd.constructor.name, input: cmd.input })
      if (cmd instanceof PutObjectCommand) { objects.set(Key, await toBuffer(cmd.input.Body)); return {} }
      if (cmd instanceof DeleteObjectCommand) { objects.delete(Key); return {} }
      const data = objects.get(Key)
      if (cmd instanceof HeadObjectCommand) { if (!data) throw notFound('NotFound'); return { ContentLength: data.length } }
      if (cmd instanceof GetObjectCommand) {
        if (!data) throw notFound('NoSuchKey')
        const m = /^bytes=(\d+)-(\d+)$/.exec(Range ?? '')
        return { Body: Readable.from([m ? data.subarray(Number(m[1]), Number(m[2]) + 1) : data]) }
      }
      throw new Error('unexpected command')
    }
  }
  return {
    sdk: { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand },
    objects, sent, config: () => clientConfig,
  }
}

const readAll = async (s: Readable | null) => {
  if (!s) return null
  const chunks: Buffer[] = []
  for await (const c of s) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks).toString('utf8')
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-storage-'))
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

const backends: Array<[string, () => Storage]> = [
  ['FsStorage', () => new FsStorage(fs.mkdtempSync(path.join(tmpRoot, 'fs-')))],
  ['S3Storage', () => { const f = fakeS3Sdk(); return new S3Storage('bucket', 'hub/', {}, async () => f.sdk) }],
]

describe.each(backends)('%s', (_name, make) => {
  let storage: Storage
  beforeEach(() => { storage = make() })

  it('stores and reads JSON, and says null for missing keys', async () => {
    expect(await storage.getJson('a/b.json')).toBeNull()
    await storage.putJson('a/b.json', { x: 1 })
    expect(await storage.getJson('a/b.json')).toEqual({ x: 1 })
    await storage.putJson('a/b.json', { x: 2 })
    expect(await storage.getJson('a/b.json')).toEqual({ x: 2 })
  })

  it('reports existence and size', async () => {
    expect(await storage.exists('obj')).toBe(false)
    expect(await storage.size('obj')).toBeNull()
    await storage.putJson('obj', 'hello')
    expect(await storage.exists('obj')).toBe(true)
    expect(await storage.size('obj')).toBe(JSON.stringify('hello').length)
  })

  it('moves a finished temp file into place and streams byte ranges', async () => {
    const tmp = path.join(tmpRoot, `upload-${Math.random()}`)
    fs.writeFileSync(tmp, '0123456789')
    await storage.putFile('objects/h', tmp, 10)
    expect(fs.existsSync(tmp)).toBe(false)
    expect(await readAll(await storage.stream('objects/h'))).toBe('0123456789')
    expect(await readAll(await storage.stream('objects/h', { start: 2, end: 5 }))).toBe('2345')
    expect(await storage.stream('objects/missing')).toBeNull()
  })

  it('deletes, and deleting something missing is fine', async () => {
    await storage.putJson('gone.json', 1)
    await storage.delete('gone.json')
    expect(await storage.exists('gone.json')).toBe(false)
    await expect(storage.delete('never.json')).resolves.toBeUndefined()
  })
})

describe('FsStorage', () => {
  it('refuses keys that would leave its folder', async () => {
    const storage = new FsStorage(fs.mkdtempSync(path.join(tmpRoot, 'jail-')))
    await expect(storage.putJson('../escape.json', 1)).rejects.toThrow(/Bad key/)
    await expect(storage.getJson('../../etc/passwd')).rejects.toThrow(/Bad key/)
  })
})

describe('S3Storage', () => {
  it('prefixes keys, configures the client once, and rethrows real errors', async () => {
    const f = fakeS3Sdk()
    let loads = 0
    const storage = new S3Storage('bucket', 'hub//', { endpoint: 'https://r2.test', region: '', forcePathStyle: true }, async () => { loads++; return f.sdk })
    await storage.putJson('x.json', 1)
    await storage.getJson('x.json')
    expect(loads).toBe(1)
    expect([...f.objects.keys()]).toEqual(['hub/x.json'])
    expect(f.config()).toEqual({ region: 'auto', endpoint: 'https://r2.test', forcePathStyle: true })

    const broken = new S3Storage('b', '', {}, async () => ({
      ...f.sdk,
      S3Client: class { async send() { throw Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } }) } },
    }))
    await expect(broken.size('k')).rejects.toThrow('AccessDenied')
    await expect(broken.stream('k')).rejects.toThrow('AccessDenied')
  })
})

describe('storageFromEnv', () => {
  it('uses S3 when a bucket is set, the data folder otherwise', () => {
    expect(storageFromEnv({ S3_BUCKET: 'b', S3_FORCE_PATH_STYLE: 'true' } as any).kind).toBe('s3')
    const dir = path.join(tmpRoot, 'env-data')
    expect(storageFromEnv({ DATA_DIR: dir } as any).kind).toBe('fs')
    expect(fs.existsSync(dir)).toBe(true)
  })
})
