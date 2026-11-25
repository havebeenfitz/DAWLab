import path from 'path'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../constants', () => ({ CAS_DIR: '/home/me/.dawlab/cas', getCommitsDir: () => '/home/me/.dawlab/commits' }))
vi.mock('../registry', () => ({
  loadRegistry: () => ({
    lodge: { storage_mode: 'project', path: '/Music/lodge.logicx' },
    snow: { storage_mode: 'home', path: '/Music/snow' },
    broken: { storage_mode: 'project', path: 'NA' },
  }),
}))

import { allCasDirs } from '../storage-location'

describe('allCasDirs', () => {
  it('counts the home store and every project that keeps its versions next to itself', () => {
    expect(allCasDirs()).toEqual([
      '/home/me/.dawlab/cas',
      path.join('/Music/lodge.logicx', '.dawlabproject', 'cas'),
    ])
  })
})
