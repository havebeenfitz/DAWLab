// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createSyncGuard, LOOP_MIN_SYNCS, LOOP_WINDOW_MS, STUCK_MS } from '../sync-guard'

describe('sync guard', () => {
  const setup = () => {
    let t = 0
    const guard = createSyncGuard(() => t)
    return { guard, at: (ms: number) => { t = ms } }
  }

  it('sees nothing wrong in normal use', () => {
    const { guard, at } = setup()
    for (let i = 0; i < LOOP_MIN_SYNCS - 1; i++) { at(i * 2_000); guard.started('f'); guard.ended('f') }
    expect(guard.trouble('f')).toBeNull()
    expect(guard.trouble('unknown')).toBeNull()
  })

  it('calls syncs that keep starting back to back a loop, until they calm down', () => {
    const { guard, at } = setup()
    for (let i = 0; i < LOOP_MIN_SYNCS; i++) { at(i * 2_000); guard.started('f'); guard.ended('f') }
    expect(guard.trouble('f')).toBe('looping')
    at((LOOP_MIN_SYNCS - 1) * 2_000 + LOOP_WINDOW_MS)
    expect(guard.trouble('f')).toBeNull()
  })

  it('calls a running sync without progress stuck, and progress clears it', () => {
    const { guard, at } = setup()
    guard.started('f')
    at(STUCK_MS - 1)
    expect(guard.trouble('f')).toBeNull()
    at(STUCK_MS)
    expect(guard.trouble('f')).toBe('stuck')
    guard.progressed('f')
    expect(guard.trouble('f')).toBeNull()
    at(STUCK_MS * 3)
    guard.ended('f')
    expect(guard.trouble('f')).toBeNull()
  })

  it('forgets a folder on reset', () => {
    const { guard } = setup()
    for (let i = 0; i < LOOP_MIN_SYNCS; i++) guard.started('f')
    guard.reset('f')
    expect(guard.trouble('f')).toBeNull()
  })
})
