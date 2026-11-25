// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildFullInvite, parseFullInvite } from '../hub-protocol'

describe('full invites (code + server)', () => {
  const code = 'WA6DEGS61SPR'

  it('round-trips an https hub as a bare host', () => {
    const inv = buildFullInvite('https://dawlab.onrender.com/', code)
    expect(inv).toMatch(/^DAWL-WA6D-EGS6-1SPR(-[0-9A-HJKMNP-TV-Z]{1,4})+$/)
    expect(inv).not.toMatch(/https|\.com|\//i)
    expect(parseFullInvite(inv)).toEqual({ hubUrl: 'https://dawlab.onrender.com', code })
  })

  it('round-trips http, ports and paths', () => {
    for (const hub of ['http://localhost:8080', 'https://hub.example.org:8443', 'https://example.org/dawlab']) {
      expect(parseFullInvite(buildFullInvite(hub, code))?.hubUrl).toBe(hub)
    }
  })

  it('accepts sloppy spelling: lowercase, spaces, no dashes, O/I/L look-alikes in the code', () => {
    const inv = buildFullInvite('https://dawlab.onrender.com', code)
    expect(parseFullInvite(inv.toLowerCase())?.hubUrl).toBe('https://dawlab.onrender.com')
    expect(parseFullInvite(inv.replace(/-/g, ' '))?.code).toBe(code)
    expect(parseFullInvite(inv.replace(/-/g, ''))?.code).toBe(code)
    expect(parseFullInvite(`  ${inv}\n`)?.code).toBe(code)
    expect(parseFullInvite('DAWL-WA6D-EGS6-ISPR')?.code).toBe(code)
  })

  it('reads a bare code without a server', () => {
    expect(parseFullInvite('DAWL-WA6D-EGS6-1SPR')).toEqual({ hubUrl: null, code })
    expect(parseFullInvite('WA6D EGS6 1SPR')).toEqual({ hubUrl: null, code })
  })

  it('rejects things that are not invites', () => {
    for (const bad of ['', 'hello', 'DAWL-1234', 'DAWL-WA6D-EGS6-1SP', 'DAWL-WA6D-EGS6-1SPR-UUUU', 'https://dawlab.onrender.com/s/x']) {
      expect(parseFullInvite(bad)).toBeNull()
    }
  })

  it('rejects a tampered server part instead of guessing', () => {
    const inv = buildFullInvite('https://dawlab.onrender.com', code)
    expect(parseFullInvite(inv.slice(0, -6))?.hubUrl ?? null).not.toBe('https://dawlab.onrender.com')
    expect(parseFullInvite('DAWL-WA6D-EGS6-1SPR-ZZZZ-ZZZZ')).toBeNull()
  })

  it('refuses non-http servers', () => {
    expect(() => buildFullInvite('ftp://x.org', code)).toThrow()
  })
})
