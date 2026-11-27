// @vitest-environment node
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { HubClient } from '../hub-client'
import { hubFetch } from '../hub-fetch'

/** A server that answers headers and then never sends the rest. */
async function stuckServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' })
    res.write('{"log":')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

describe('hub requests never hang', () => {
  it('a request whose answer stalls fails after its deadline', async () => {
    const { server, base } = await stuckServer()
    try {
      const res = await hubFetch(`${base}/api/space`, {}, 300)
      await expect(res.text()).rejects.toThrow()
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  it('HubClient JSON calls go through the deadline', async () => {
    const { server, base } = await stuckServer()
    try {
      const client = new HubClient(base, 't'.repeat(32), '/space/projects/p')
      const started = Date.now()
      await expect(Promise.race([
        client.getProject(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('no deadline')), 65_000)),
      ])).rejects.not.toThrow('no deadline')
      expect(Date.now() - started).toBeLessThan(65_000)
    } finally {
      server.closeAllConnections()
      server.close()
    }
  }, 70_000)
})
