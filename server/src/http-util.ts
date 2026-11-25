/** Small HTTP and crypto helpers shared by the hub's route modules. */
import http from 'node:http'
import crypto from 'node:crypto'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Thrown for anything a caller without a valid key or token could probe: answered with an empty 404. */
export const HIDDEN = new HttpError(404, '')

const JSON_LIMIT = 8 * 1024 * 1024
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex')
export const newToken = (): string => crypto.randomBytes(24).toString('base64url')
export const isId = (value: unknown): value is string => typeof value === 'string' && ID_RE.test(value)
export const nowIso = (): string => new Date().toISOString()

/** Serializes read-modify-write of one JSON document within this process. */
const locks = new Map<string, Promise<unknown>>()
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  locks.set(key, next)
  next.finally(() => { if (locks.get(key) === next) locks.delete(key) }).catch(() => {})
  return next
}

/** The capability token a request carries: X-Hub-Token (what DAWLab sends) or Authorization: Bearer. */
export function requestToken(req: http.IncomingMessage): string {
  // Some proxies in front of a hub rewrite or drop Authorization, so X-Hub-Token comes first.
  const header = req.headers.authorization ?? ''
  const token = String(req.headers['x-hub-token'] ?? '').trim() || (header.startsWith('Bearer ') ? header.slice(7).trim() : '')
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) throw HIDDEN
  return token
}

/** Render and most hosts put the caller first in X-Forwarded-For. */
export function clientIp(req: http.IncomingMessage): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return fwd || req.socket.remoteAddress || 'unknown'
}

export interface FailureLimiter {
  blocked(ip: string): boolean
  fail(ip: string): void
}

/** At most `limit` failures per address per window; after that the caller is blocked until the window passes. */
export function createFailureLimiter(limit = 10, windowMs = 15 * 60 * 1000): FailureLimiter {
  const hits = new Map<string, number[]>()
  const recent = (ip: string) => (hits.get(ip) ?? []).filter((t) => Date.now() - t < windowMs)
  return {
    blocked: (ip) => recent(ip).length >= limit,
    fail: (ip) => {
      hits.set(ip, [...recent(ip), Date.now()])
      if (hits.size > 10_000) hits.delete(hits.keys().next().value!)
    },
  }
}

/** Checks `X-Hub-Key` in constant time, rate limited per address. A miss is the hidden 404. */
export function checkHubKey(req: http.IncomingMessage, createKey: string | undefined, limiter: FailureLimiter): void {
  if (!createKey) return
  const ip = clientIp(req)
  if (limiter.blocked(ip)) throw HIDDEN
  const given = String(req.headers['x-hub-key'] ?? '')
  const a = Buffer.from(sha256(given)), b = Buffer.from(sha256(createKey))
  if (!crypto.timingSafeEqual(a, b)) {
    limiter.fail(ip)
    throw HIDDEN
  }
}

export function send(res: http.ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

export async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > JSON_LIMIT) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
}

/** A trimmed display name of 1..max characters, or a readable 400. */
export function displayName(value: unknown, what: string, max = 60): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > max) throw new HttpError(400, `${what} must be 1 to ${max} characters`)
  return name
}
