// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseDeepLink } from '../deep-link'

describe('parseDeepLink', () => {
  it('recognises shared folder invites', () => {
    const url = 'dawlab://join?hub=https%3A%2F%2Fhub.test&code=DAWL-7KQ4-MX2P-9TRB'
    expect(parseDeepLink(url)).toEqual({ kind: 'join', url })
    expect(parseDeepLink(' DAWLAB://JOIN?code=x ')).toEqual({ kind: 'join', url: 'DAWLAB://JOIN?code=x' })
    expect(parseDeepLink('dawlab://join')).toEqual({ kind: 'join', url: 'dawlab://join' })
    expect(parseDeepLink('dawlab://joinery?x=1')).toBeNull()
  })

  it('recognises project links and needs a name and an id', () => {
    expect(parseDeepLink('dawlab://open/project?name=Snow&id=p1&commit=c9')).toEqual({
      kind: 'open-project', projectName: 'Snow', projectId: 'p1', commitId: 'c9',
    })
    expect(parseDeepLink('dawlab://open/project?name=Snow&id=p1')).toMatchObject({ commitId: null })
    expect(parseDeepLink('dawlab://open/project?name=Snow')).toBeNull()
    expect(parseDeepLink('dawlab://open/project')).toBeNull()
  })

  it('ignores everything else', () => {
    for (const url of ['', 'https://hub.test/s/abc', 'dawlab://auth/callback?code=1', 'javascript:alert(1)']) {
      expect(parseDeepLink(url)).toBeNull()
    }
  })
})
