/**
 * Where the hub keeps its data. Everything is a key -> bytes object, so the
 * same code runs on a local disk (Docker volume, Render Disk) or any
 * S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
 *
 * Layout:
 *   tokens/<sha256(token)>.json              -> { projectId, role } | { kind: 'member', spaceId, memberId }
 *   projects/<id>/meta.json                  -> { id, name, createdAt, updatedAt?, spaceId? }
 *   projects/<id>/log.json                   -> SharedLog
 *   projects/<id>/commits/<cid>/filemap.json -> FileMapEntry[]
 *   projects/<id>/commits/<cid>/comments.json
 *   projects/<id>/objects/<sha256>           -> file contents
 *   spaces/<id>/{meta,members,invites,projects}.json, invites/<sha256(code)>.json
 *                                            -> see docs/hub-spaces.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

export interface ByteRange {
  start: number
  end: number
}

export interface Storage {
  readonly kind: string
  getJson<T>(key: string): Promise<T | null>
  putJson(key: string, value: unknown): Promise<void>
  exists(key: string): Promise<boolean>
  size(key: string): Promise<number | null>
  /** Moves a finished temp file into place (the file is consumed). */
  putFile(key: string, tmpPath: string, size: number): Promise<void>
  stream(key: string, range?: ByteRange): Promise<Readable | null>
  /** Removes a key; a missing key is not an error. */
  delete(key: string): Promise<void>
}

export class FsStorage implements Storage {
  readonly kind = 'fs'
  private readonly root: string
  constructor(root: string) {
    this.root = root
    fs.mkdirSync(root, { recursive: true })
  }

  private file(key: string) {
    const full = path.join(this.root, key)
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Bad key: ${key}`)
    return full
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.promises.readFile(this.file(key), 'utf8')) as T
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  }

  async putJson(key: string, value: unknown) {
    const full = this.file(key)
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify(value))
    await fs.promises.rename(tmp, full)
  }

  async exists(key: string) {
    return (await this.size(key)) !== null
  }

  async size(key: string) {
    try {
      return (await fs.promises.stat(this.file(key))).size
    } catch {
      return null
    }
  }

  async putFile(key: string, tmpPath: string) {
    const full = this.file(key)
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    try {
      await fs.promises.rename(tmpPath, full)
    } catch (err: any) {
      if (err?.code !== 'EXDEV') throw err
      await fs.promises.copyFile(tmpPath, full)
      await fs.promises.rm(tmpPath, { force: true })
    }
  }

  async stream(key: string, range?: ByteRange) {
    const full = this.file(key)
    if (!fs.existsSync(full)) return null
    return fs.createReadStream(full, range ? { start: range.start, end: range.end } : {})
  }

  async delete(key: string) {
    await fs.promises.rm(this.file(key), { force: true })
  }
}

export class S3Storage implements Storage {
  readonly kind = 's3'
  private client: any
  private sdk: any

  private readonly bucket: string
  private readonly prefix: string
  private readonly config: { endpoint?: string; region?: string; forcePathStyle?: boolean }
  /** Loads the AWS SDK on first use (it's only installed where S3 is used); tests pass a fake. */
  private readonly loadSdk: () => Promise<any>

  constructor(
    bucket: string,
    prefix: string,
    config: { endpoint?: string; region?: string; forcePathStyle?: boolean },
    loadSdk: () => Promise<any> = () => import('@aws-sdk/client-s3'),
  ) {
    this.bucket = bucket
    this.prefix = prefix
    this.config = config
    this.loadSdk = loadSdk
  }

  private async s3() {
    if (!this.client) {
      this.sdk = await this.loadSdk()
      this.client = new this.sdk.S3Client({
        region: this.config.region || 'auto',
        endpoint: this.config.endpoint || undefined,
        forcePathStyle: this.config.forcePathStyle,
      })
    }
    return { client: this.client, sdk: this.sdk }
  }

  private key(key: string) {
    return this.prefix ? `${this.prefix.replace(/\/+$/, '')}/${key}` : key
  }

  async getJson<T>(key: string): Promise<T | null> {
    const body = await this.stream(key)
    if (!body) return null
    const chunks: Buffer[] = []
    for await (const chunk of body) chunks.push(Buffer.from(chunk))
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  }

  async putJson(key: string, value: unknown) {
    const { client, sdk } = await this.s3()
    await client.send(new sdk.PutObjectCommand({
      Bucket: this.bucket, Key: this.key(key), Body: JSON.stringify(value), ContentType: 'application/json',
    }))
  }

  async exists(key: string) {
    return (await this.size(key)) !== null
  }

  async size(key: string) {
    const { client, sdk } = await this.s3()
    try {
      const head = await client.send(new sdk.HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }))
      return Number(head.ContentLength ?? 0)
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null
      throw err
    }
  }

  async putFile(key: string, tmpPath: string, size: number) {
    const { client, sdk } = await this.s3()
    try {
      await client.send(new sdk.PutObjectCommand({
        Bucket: this.bucket, Key: this.key(key), Body: fs.createReadStream(tmpPath), ContentLength: size,
      }))
    } finally {
      await fs.promises.rm(tmpPath, { force: true })
    }
  }

  async stream(key: string, range?: ByteRange) {
    const { client, sdk } = await this.s3()
    try {
      const res = await client.send(new sdk.GetObjectCommand({
        Bucket: this.bucket, Key: this.key(key), Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }))
      return res.Body as Readable
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return null
      throw err
    }
  }

  async delete(key: string) {
    const { client, sdk } = await this.s3()
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }))
  }
}

export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.S3_BUCKET) {
    return new S3Storage(env.S3_BUCKET, env.S3_PREFIX || '', {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    })
  }
  return new FsStorage(path.resolve(env.DATA_DIR || './data'))
}
