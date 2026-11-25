// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { newVersionId, versionIdTime } from '../version-id'
import { isCommitId } from '../../../../shared/hub-protocol'

describe('version ids', () => {
  it('keep the save time first, so they still sort by time, and add a random suffix', () => {
    const a = newVersionId('20261125160719')
    const b = newVersionId('20261125160719')
    expect(a).toMatch(/^20261125160719-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
    expect([newVersionId('20261125160720'), a].sort()[0]).toBe(a)
    expect(newVersionId('20261125160719', () => Buffer.from([0, 1, 2, 255]))).toBe('20261125160719-000102ff')
  })

  it('read the time from old and new ids', () => {
    expect(versionIdTime('20261125160719')).toBe('20261125160719')
    expect(versionIdTime('20261125160719-0a1b2c3d')).toBe('20261125160719')
  })

  it('are valid for the hub in both forms', () => {
    expect(isCommitId('20261125160719')).toBe(true)
    expect(isCommitId(newVersionId('20261125160719'))).toBe(true)
    expect(isCommitId('2026/11/25')).toBe(false)
  })
})
