// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  mergeLogs, parseShareLink, toSharedLog,
  normalizeInviteCode, formatInviteCode, isInviteCode, parseJoinLink, buildJoinLink,
} from '../hub-protocol'

const log = (branches: any[]) => ({ id: 'p', name: 'Song', daw: 'Ableton Live', branches })

describe('hub protocol', () => {
  it('merges logs without losing versions from either side', () => {
    const local = { ...log([{ name: 'main', commits: [{ commit_id: '1', timestamp: '1', message: 'a', author: 'x' }] }]), lastCheckout: { commitId: '1' } }
    const remote = toSharedLog(log([
      { name: 'main', commits: [{ commit_id: '2', timestamp: '2', message: 'b', author: 'y' }, { commit_id: '1', timestamp: '1', message: 'a', author: 'x', preview_file: 'h' }] },
      { name: 'alt', commits: [] },
    ]))
    const merged: any = mergeLogs(local, remote)
    expect(merged.branches[0].commits.map((c: any) => c.commit_id)).toEqual(['1', '2'])
    expect(merged.branches[0].commits[0].preview_file).toBe('h')
    expect(merged.branches.map((b: any) => b.name)).toEqual(['main', 'alt'])
    expect(merged.lastCheckout).toEqual({ commitId: '1' })
  })

  it('never shares local-only state', () => {
    const shared: any = toSharedLog({ ...log([]), lastCheckout: {}, draft: {}, current_branch: 'x', collaborators: [] })
    expect(Object.keys(shared).sort()).toEqual(['branches', 'daw', 'id', 'name'])
  })

  it('parses share links, including hubs under a path', () => {
    expect(parseShareLink('https://hub.example.com/s/abcdefghijklmnopqrstuvwx')).toEqual({ hubUrl: 'https://hub.example.com', token: 'abcdefghijklmnopqrstuvwx' })
    expect(parseShareLink(' https://x.io/dawlab/s/abcdefghijklmnopqrstuvwx/ ').hubUrl).toBe('https://x.io/dawlab')
    expect(() => parseShareLink('https://x.io/nope')).toThrow()
  })

  describe('invite codes', () => {
    it('normalizes case, separators, the DAWL prefix and look-alike letters', () => {
      expect(normalizeInviteCode('DAWL-ABCD-EFGH-JKMN')).toBe('ABCDEFGHJKMN')
      expect(normalizeInviteCode(' dawl abcd efgh jkmn ')).toBe('ABCDEFGHJKMN')
      expect(normalizeInviteCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN')
      expect(normalizeInviteCode('DAWL-I0LO-oil1-2345')).toBe('101001112345')
      // a raw code that happens to start with DAW is kept intact
      expect(normalizeInviteCode('DAW1-2345-6789')).toBe('DAW123456789')
    })

    it('validates codes', () => {
      expect(isInviteCode('DAWL-ABCD-EFGH-JKMN')).toBe(true)
      expect(isInviteCode('dawl-abcd-efgh-jkmn')).toBe(true)
      expect(isInviteCode('DAWL-ABCD-EFGH-JKM')).toBe(false)
      expect(isInviteCode('DAWL-ABCD-EFGH-JKMU')).toBe(false) // U is not Crockford
      expect(isInviteCode('')).toBe(false)
      expect(isInviteCode('DAWL-ABCD-EFGH-JKMN-PQRS')).toBe(false)
    })

    it('formats 12 raw characters as DAWL-XXXX-XXXX-XXXX', () => {
      expect(formatInviteCode('ABCDEFGHJKMN')).toBe('DAWL-ABCD-EFGH-JKMN')
      expect(formatInviteCode('abcd efgh jkmn')).toBe('DAWL-ABCD-EFGH-JKMN')
      expect(() => formatInviteCode('short')).toThrow()
    })

    it('builds and parses app join links', () => {
      const link = buildJoinLink('https://hub.example.com/dawlab/', 'abcdefghjkmn')
      expect(link).toBe('dawlab://join?hub=https%3A%2F%2Fhub.example.com%2Fdawlab&code=DAWL-ABCD-EFGH-JKMN')
      expect(parseJoinLink(link)).toEqual({ hubUrl: 'https://hub.example.com/dawlab', code: 'DAWL-ABCD-EFGH-JKMN' })
      expect(parseJoinLink(' dawlab://join?hub=http%3A%2F%2F127.0.0.1%3A8080&code=abcdefghjkmn '))
        .toEqual({ hubUrl: 'http://127.0.0.1:8080', code: 'DAWL-ABCD-EFGH-JKMN' })
      expect(() => parseJoinLink('https://hub.example.com/join?hub=x&code=DAWL-ABCD-EFGH-JKMN')).toThrow()
      expect(() => parseJoinLink('dawlab://open?hub=https%3A%2F%2Fh.io&code=DAWL-ABCD-EFGH-JKMN')).toThrow()
      expect(() => parseJoinLink('dawlab://join?hub=ftp%3A%2F%2Fh.io&code=DAWL-ABCD-EFGH-JKMN')).toThrow()
      expect(() => parseJoinLink('dawlab://join?hub=https%3A%2F%2Fh.io&code=nope')).toThrow()
      expect(() => parseJoinLink('not a link')).toThrow()
    })
  })
})
