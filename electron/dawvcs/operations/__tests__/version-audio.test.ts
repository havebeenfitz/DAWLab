// @vitest-environment node
import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'

const { ROOT } = vi.hoisted(() => {
  const os = require('os'), path = require('path'), fs = require('fs')
  const dir = path.join(os.tmpdir(), `dawlab-version-audio-${process.pid}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return { ROOT: dir }
})

vi.mock('../../core/storage-location', () => ({
  getProjectStorageDirs: () => ({ commitsDir: require('path').join(ROOT, 'commits'), casDir: require('path').join(ROOT, 'cas') }),
}))

import { findVersionAudio } from '../version-audio'
import { getCasPath } from '../../core/cas'

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }))

function version(id: string, files: Record<string, string | null>) {
  const map = Object.entries(files).map(([p, content]) => {
    if (content === null) return { path: p, hash: 'empty' }
    const hash = `${id}${p}`.replace(/[^a-z0-9]/gi, '').padEnd(8, '0').toLowerCase()
    const file = getCasPath(hash, path.join(ROOT, 'cas'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return { path: p, hash }
  })
  fs.mkdirSync(path.join(ROOT, 'commits', 'Song', id), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'commits', 'Song', id, 'filemap.json'), JSON.stringify(map))
}

describe('findVersionAudio', () => {
  version('v1', { 'Bounces/lodge.mp3': 'mp3 v1', 'Audio Files/Kick.WAV': 'wav', 'Song.als': 'set', 'Empty Folder': null })
  version('v2', { 'Bounces/lodge.mp3': 'mp3 v2' })

  it('finds the stored copy of an audio file in that exact version', () => {
    const v1 = findVersionAudio('Song', 'v1', 'Bounces/lodge.mp3')!
    const v2 = findVersionAudio('Song', 'v2', 'Bounces/lodge.mp3')!
    expect(fs.readFileSync(v1.file, 'utf8')).toBe('mp3 v1')
    expect(fs.readFileSync(v2.file, 'utf8')).toBe('mp3 v2')
    expect(v1.extension).toBe('.mp3')
    expect(findVersionAudio('Song', 'v1', 'Audio Files/Kick.WAV')?.extension).toBe('.wav')
  })

  it('refuses files that are not playable audio, missing, or not in that version', () => {
    expect(findVersionAudio('Song', 'v1', 'Song.als')).toBeNull()
    expect(findVersionAudio('Song', 'v1', 'Empty Folder')).toBeNull()
    expect(findVersionAudio('Song', 'v2', 'Audio Files/Kick.WAV')).toBeNull()
    expect(findVersionAudio('Song', 'v1', '../../etc/passwd.wav')).toBeNull()
    const stored = findVersionAudio('Song', 'v1', 'Audio Files/Kick.WAV')!.file
    fs.rmSync(stored)
    expect(findVersionAudio('Song', 'v1', 'Audio Files/Kick.WAV')).toBeNull()
  })
})
