// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { addNotices, alertsFor, emptyFeed, markRead, parseFeed, readProject, setMuted, setSound, soundPlan, unreadCount, versionTime, type FeedState } from '../version-feed'
import { checkForNewVersions, feedStore, type WatcherDeps } from '../version-watcher'

const now = new Date('2026-11-25T20:00:00Z')
const ref = { folderId: 'f1', folderName: 'Chigura', hubProjectId: 'p1', projectName: 'test' }
const log = (...commits: Array<[string, string, string, string?]>) => ({
  branches: [
    { name: 'main', commits: commits.filter((c) => !c[3]).map(([commit_id, author, message]) => ({ commit_id, author, message, timestamp: `20261125${commit_id.padStart(6, '0')}` })) },
    { name: 'elena · 25 Nov', forkOf: { branch: 'main' }, commits: commits.filter((c) => c[3]).map(([commit_id, author, message]) => ({ commit_id, author, message, timestamp: `20261125${commit_id.padStart(6, '0')}` })) },
  ],
})

describe('reading a project', () => {
  it('announces nothing the first time it sees a project', () => {
    const r = readProject(undefined, log(['100', 'elena', 'a'], ['200', 'max', 'b']), ref, 'max', 'u1', now)
    expect(r.notices).toEqual([])
    expect(r.cursor).toEqual({ updatedAt: 'u1', seen: ['100', '200'] })
  })

  it('announces new versions by others, never your own, and marks parallel ones', () => {
    const first = readProject(undefined, log(['100', 'elena', 'a']), ref, 'max', 'u1', now)
    const r = readProject(first.cursor, log(['100', 'elena', 'a'], ['171150', 'elena', 'аудио'], ['171200', 'max', 'mine'], ['171300', 'elena', 'alt', 'fork']), ref, 'max', 'u2', now)
    expect(r.notices.map((n) => [n.commitId, n.author, n.parallel])).toEqual([['171300', 'elena', true], ['171150', 'elena', false]])
    expect(r.notices[1]).toMatchObject({ id: 'p1:171150', message: 'аудио', projectName: 'test', folderName: 'Chigura', at: '2026-11-25T17:11:50.000Z', read: false })
  })
})

describe('the feed', () => {
  const notice = (commitId: string, extra: Partial<ReturnType<typeof readProject>['notices'][number]> = {}) => ({
    id: `p1:${commitId}`, ...ref, commitId, author: 'elena', message: commitId, branch: 'main', parallel: false, at: `2026-11-25T17:${commitId}:00.000Z`, read: false, ...extra,
  })

  it('never lists the same version twice', () => {
    const one = addNotices(emptyFeed(), [notice('10')])
    const again = addNotices(one.state, [notice('10'), notice('11')])
    expect(again.added.map((n) => n.commitId)).toEqual(['11'])
    expect(again.state.notices.map((n) => n.commitId)).toEqual(['11', '10'])
  })

  it('one version: who saved what, where', () => {
    expect(alertsFor(emptyFeed(), [notice('10', { message: 'аудио' })])).toEqual([
      { title: 'elena saved a version', body: '“аудио” in test · Chigura', target: expect.objectContaining({ commitId: '10' }) },
    ])
    expect(alertsFor(emptyFeed(), [notice('10', { parallel: true })])[0].title).toBe('elena saved a parallel version')
  })

  it('groups several into one per shared folder, opening the newest', () => {
    const alerts = alertsFor(emptyFeed(), [notice('10'), notice('12', { author: 'bob', projectName: 'snow' }), notice('11')])
    expect(alerts).toHaveLength(1)
    expect(alerts[0].title).toBe('3 new versions in Chigura')
    expect(alerts[0].body).toContain('bob, elena')
    expect(alerts[0].target.commitId).toBe('12')
  })

  it('stays quiet for a muted folder or when switched off, but still lists them', () => {
    const muted = setMuted(emptyFeed(), 'f1', true)
    expect(alertsFor(muted, [notice('10')])).toEqual([])
    expect(alertsFor({ ...emptyFeed(), enabled: false }, [notice('10')])).toEqual([])
    expect(alertsFor(setMuted(muted, 'f1', false), [notice('10')])).toHaveLength(1)
    expect(addNotices(muted, [notice('10')]).state.notices).toHaveLength(1)
  })

  it('marks one project read, or everything', () => {
    const s = addNotices(emptyFeed(), [notice('10'), notice('11', { projectName: 'snow' })]).state
    expect(unreadCount(markRead(s, 'test'))).toBe(1)
    expect(unreadCount(markRead(s))).toBe(0)
  })

  it('reads a damaged file as an empty feed', () => {
    expect(parseFeed('nonsense')).toEqual(emptyFeed())
    expect(parseFeed({ enabled: false, muted: ['f1'], cursors: { p1: { seen: [1] }, bad: {} }, notices: [{ id: 1 }] })).toEqual({ enabled: false, sound: 'rooster', muted: ['f1'], cursors: { p1: { updatedAt: undefined, seen: ['1'] } }, notices: [] })
  })

  it('understands DAWLab version stamps', () => {
    expect(versionTime('20261125171150', now)).toBe('2026-11-25T17:11:50.000Z')
    expect(versionTime('garbage', now)).toBe(now.toISOString())
  })
})

describe('checking the shared folders', () => {
  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-notify-'))
    const store = feedStore(() => dir)
    let hub = { updatedAt: 'u1', log: log(['100', 'elena', 'a']) }
    const readLog = vi.fn(async () => hub.log)
    const deps: WatcherDeps = {
      spaces: () => [{ folderId: 'f1', name: 'Chigura' }],
      listProjects: async () => [{ id: 'p1', name: 'test', updatedAt: hub.updatedAt }],
      readLog,
      me: () => 'max',
      load: store.load,
      save: store.save,
      now: () => now,
    }
    return { deps, readLog, set: (next: typeof hub) => { hub = next }, dir }
  }

  it('announces a collaborator\'s version once, even across a restart', async () => {
    const w = setup()
    expect((await checkForNewVersions(w.deps)).added).toEqual([])
    w.set({ updatedAt: 'u2', log: log(['100', 'elena', 'a'], ['171150', 'elena', 'аудио']) })
    const r = await checkForNewVersions(w.deps)
    expect(r.alerts.map((a) => a.title)).toEqual(['elena saved a version'])
    expect(r.changedFolders).toEqual(['f1'])
    // A new run of DAWLab reads the same file: nothing is announced again.
    const restarted = { ...w.deps, ...feedStore(() => w.dir) }
    expect((await checkForNewVersions(restarted)).added).toEqual([])
    expect(feedStore(() => w.dir).load().notices).toHaveLength(1)
  })

  it('does not read a project whose history did not change', async () => {
    const w = setup()
    await checkForNewVersions(w.deps)
    await checkForNewVersions(w.deps)
    expect(w.readLog).toHaveBeenCalledTimes(1)
  })

  it('skips a folder the hub cannot be reached for', async () => {
    const w = setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await checkForNewVersions({ ...w.deps, listProjects: async () => { throw new Error('offline') } })
    expect(r.added).toEqual([])
    warn.mockRestore()
  })

  it('keeps the mute and on/off choice in the stored feed', () => {
    const w = setup()
    const s: FeedState = setMuted({ ...emptyFeed(), enabled: false }, 'f1', true)
    w.deps.save(s)
    expect(w.deps.load()).toMatchObject({ enabled: false, muted: ['f1'] })
  })
})

describe('the notification sound', () => {
  it('crows once per batch by default, with macOS kept quiet', () => {
    expect(soundPlan(emptyFeed(), 3)).toEqual({ silent: true, play: { kind: 'rooster' } })
    expect(soundPlan(emptyFeed(), 0)).toEqual({ silent: true, play: null })
  })

  it('leaves the sound to macOS, plays a chosen file, or stays silent', () => {
    expect(soundPlan({ sound: 'system' }, 1)).toEqual({ silent: false, play: null })
    expect(soundPlan({ sound: 'none' }, 1)).toEqual({ silent: true, play: null })
    expect(soundPlan({ sound: 'custom', soundFile: '/s/ding.aiff' }, 1)).toEqual({ silent: true, play: { kind: 'file', path: '/s/ding.aiff' } })
  })

  it('accepts only sound files for a custom sound, and keeps the choice', () => {
    expect(() => setSound(emptyFeed(), 'custom', '/x/notes.txt')).toThrow('Choose a sound file')
    expect(() => setSound(emptyFeed(), 'trumpet')).toThrow('Unknown sound.')
    const custom = setSound(emptyFeed(), 'custom', '/s/Ding.WAV')
    expect(custom).toMatchObject({ sound: 'custom', soundFile: '/s/Ding.WAV' })
    expect(setSound(custom, 'rooster')).toMatchObject({ sound: 'rooster', soundFile: '/s/Ding.WAV' })
    expect(setSound(setSound(custom, 'none'), 'custom')).toMatchObject({ sound: 'custom', soundFile: '/s/Ding.WAV' })
    expect(parseFeed(JSON.parse(JSON.stringify(custom)))).toMatchObject({ sound: 'custom', soundFile: '/s/Ding.WAV' })
    expect(parseFeed({ sound: 'custom' }).sound).toBe('rooster')
  })
})
