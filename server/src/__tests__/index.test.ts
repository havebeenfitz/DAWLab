// @vitest-environment node
/** Starting the hub: it refuses to run without a creation password and warns about a short one. */
import { describe, it, expect, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const entry = path.resolve(__dirname, '../index.ts')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-index-'))
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }))

function start(env: Record<string, string>, waitFor: RegExp | 'exit'): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH ?? '', DATA_DIR: dataDir, PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timed out: ${output}`)) }, 15_000)
    const onData = (d: Buffer) => {
      output += d
      if (waitFor !== 'exit' && waitFor.test(output)) {
        child.kill('SIGTERM')
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output }) })
  })
}

describe('hub startup', () => {
  it('refuses to start without HUB_CREATE_KEY', async () => {
    const { code, output } = await start({}, 'exit')
    expect(code).toBe(1)
    expect(output).toMatch(/Set HUB_CREATE_KEY \(12\+ characters\)/)
  })

  it('refuses a key shorter than 12 characters', async () => {
    const { code } = await start({ HUB_CREATE_KEY: 'short' }, 'exit')
    expect(code).toBe(1)
  })

  it('warns about a short key but starts, and stops cleanly on SIGTERM', async () => {
    const { code, output } = await start({ HUB_CREATE_KEY: 'twelve-chars-ok' }, /DAWLab Hub on/)
    expect(output).toMatch(/HUB_CREATE_KEY is short/)
    expect(output).toMatch(/DAWLab Hub on :\d+ \(storage: fs\)/)
    expect(code).toBe(0)
  })

  it('starts quietly with a long key', async () => {
    const { output } = await start({ HUB_CREATE_KEY: 'x'.repeat(40) }, /DAWLab Hub on/)
    expect(output).not.toMatch(/is short/)
  })
})
