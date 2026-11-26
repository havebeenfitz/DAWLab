import { describe, it, expect } from 'vitest'
import { isNoisePath, isNoiseDir } from '../noise'
import { diffFileMaps } from '../version-diff'

describe('noise files', () => {
  it('recognises undo history, autosaves, Finder files and DAWLab storage', () => {
    for (const p of [
      'Song.logicx/Alternatives/000/Undo Data.nosync/1.undo',
      'Song.logicx/Alternatives/000/Autosave/ProjectData',
      'Audio Files/.DS_Store', '._Song.als', '.dawlab-metadata-debug.json',
      '.dawlabproject/cas/aa/bb/x', 'Backup/Song [2026-01-01].als', 'Thing.nosync/file',
    ]) expect(isNoisePath(p), p).toBe(true)
    for (const p of ['Song.als', 'Audio Files/kick.wav', 'Song.logicx/Alternatives/000/ProjectData', 'Bounces/Song.mp3', 'Backups.txt'])
      expect(isNoisePath(p), p).toBe(false)
    expect(isNoiseDir('Undo Data.nosync')).toBe(true)
    expect(isNoiseDir('Audio Files')).toBe(false)
  })

  it('keeps noise out of the changes between versions', () => {
    const before = [{ path: 'Song.als', hash: 'a' }, { path: 'Undo Data.nosync/x', hash: '1' }, { path: '.DS_Store', hash: 'd1' }]
    const after = [{ path: 'Song.als', hash: 'b' }, { path: 'Undo Data.nosync/x', hash: '2' }, { path: '.DS_Store', hash: 'd2' }, { path: 'Autosave/y', hash: 'z' }]
    const diff = diffFileMaps(before, after)
    expect(diff.changes).toEqual([{ kind: 'modified', path: 'Song.als' }])
    expect(diff.unchanged).toBe(0)
  })
})

describe('Logic layout files', () => {
  it('are window and screen state inside a Logic project, nothing else', async () => {
    const { isLayoutPath } = await import('../noise')
    expect(isLayoutPath('Song.logicx/Alternatives/000/DisplayState.plist')).toBe(true)
    expect(isLayoutPath('Song.logicx/Alternatives/000/WindowImage.jpg')).toBe(true)
    expect(isLayoutPath('Song.logicx/Alternatives/000/ProjectData')).toBe(false)
    expect(isLayoutPath('Bounces/WindowImage.jpg')).toBe(false)
  })
})
