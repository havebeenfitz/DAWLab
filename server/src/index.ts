import http from 'node:http'
import { createHub } from './app.ts'
import { storageFromEnv } from './storage.ts'

const port = Number(process.env.PORT || 8080)
const storage = storageFromEnv()
const createKey = process.env.HUB_CREATE_KEY || undefined

if (!createKey || createKey.length < 12) {
  console.error('[hub] Set HUB_CREATE_KEY (12+ characters). It is the password for creating projects on this hub.')
  process.exit(1)
}
if (createKey.length < 32) {
  console.warn('[hub] HUB_CREATE_KEY is short; use a long random one, e.g. `openssl rand -hex 32`.')
}

const server = http.createServer(createHub({
  storage,
  createKey,
  publicUrl: process.env.PUBLIC_URL || undefined,
  maxUploadBytes: process.env.MAX_UPLOAD_MB ? Number(process.env.MAX_UPLOAD_MB) * 1024 * 1024 : undefined,
}))
server.requestTimeout = 0 // large uploads over slow links; headersTimeout still drops stalled requests
server.headersTimeout = 30_000
server.listen(port, () => console.log(`[hub] DAWLab Hub on :${port} (storage: ${storage.kind})`))

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
