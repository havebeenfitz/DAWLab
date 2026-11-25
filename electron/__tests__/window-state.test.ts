// @vitest-environment node
import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import {
  parseWindowState, fitToDisplays, defaultBounds, initialWindowState,
  readWindowState, writeWindowState, trackWindowState, MIN_SIZE, type Rect,
} from '../window-state'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dawlab-window-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const laptop: Rect = { x: 0, y: 25, width: 1512, height: 920 }
const external: Rect = { x: 1512, y: 0, width: 2560, height: 1415 }

describe('first launch', () => {
  it('opens at about half the screen wide and 72% high, centred', () => {
    expect(defaultBounds({ x: 0, y: 25, width: 2020, height: 1500 })).toEqual({ x: 485, y: 235, width: 1050, height: 1080 })
  })

  it('never opens below the minimum size, nor larger than the screen', () => {
    expect(defaultBounds({ x: 0, y: 0, width: 1000, height: 600 })).toMatchObject({ width: MIN_SIZE.width, height: MIN_SIZE.height })
    expect(defaultBounds({ x: 0, y: 0, width: 600, height: 400 })).toEqual({ x: 0, y: 0, width: 600, height: 400 })
  })

  it('is not maximized or full screen', () => {
    expect(initialWindowState(null, [laptop], laptop)).toEqual({ bounds: defaultBounds(laptop), maximized: false, fullScreen: false })
  })
})

describe('restoring', () => {
  const saved = { bounds: { x: 1700, y: 100, width: 1200, height: 800 }, maximized: false, fullScreen: false }

  it('keeps a place that is on a screen', () => {
    expect(initialWindowState(saved, [laptop, external], laptop)).toEqual(saved)
  })

  it('keeps maximized and full screen', () => {
    expect(initialWindowState({ ...saved, maximized: true }, [laptop, external], laptop).maximized).toBe(true)
    expect(initialWindowState({ ...saved, fullScreen: true }, [laptop, external], laptop).fullScreen).toBe(true)
  })

  it('moves the window back when its screen was unplugged', () => {
    const fitted = initialWindowState(saved, [laptop], laptop).bounds
    expect(fitted).toEqual({ x: 156, y: 85, width: 1200, height: 800 })
  })

  it('shrinks a window larger than the screen it is on', () => {
    expect(fitToDisplays({ x: 10, y: 30, width: 3000, height: 2000 }, [laptop])).toEqual({ x: 10, y: 30, width: 1512, height: 920 })
  })

  it('brings back a window whose title bar is off screen', () => {
    const fitted = fitToDisplays({ x: 100, y: -500, width: 800, height: 600 }, [laptop])
    expect(fitted.y).toBeGreaterThanOrEqual(laptop.y)
    expect(fitted).toMatchObject({ width: 800, height: 600 })
  })

  it('grows a tiny saved window to the minimum size', () => {
    expect(fitToDisplays({ x: 0, y: 0, width: 300, height: 200 }, [laptop])).toMatchObject({ width: MIN_SIZE.width, height: MIN_SIZE.height })
  })
})

describe('the saved file', () => {
  it('rejects broken or nonsense data', () => {
    expect(parseWindowState(null)).toBeNull()
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 0, height: 10 } })).toBeNull()
    expect(parseWindowState({ bounds: { x: 'a', y: 0, width: 10, height: 10 } })).toBeNull()
    expect(parseWindowState({ bounds: { x: 1.4, y: 2, width: 800, height: 600 }, maximized: 'yes' }))
      .toEqual({ bounds: { x: 1, y: 2, width: 800, height: 600 }, maximized: false, fullScreen: false })
  })

  it('round-trips and survives a missing or corrupt file', () => {
    const file = path.join(tmp, 'a', 'window-state.json')
    expect(readWindowState(file)).toBeNull()
    const state = { bounds: { x: 5, y: 6, width: 900, height: 700 }, maximized: true, fullScreen: false }
    writeWindowState(file, state)
    expect(readWindowState(file)).toEqual(state)
    fs.writeFileSync(file, '{oops')
    expect(readWindowState(file)).toBeNull()
  })
})

describe('tracking the window', () => {
  function fakeWindow() {
    const win = Object.assign(new EventEmitter(), {
      bounds: { x: 10, y: 20, width: 900, height: 700 },
      maximized: false, fullScreen: false, minimized: false, destroyed: false,
      getNormalBounds() { return win.bounds },
      isMaximized() { return win.maximized },
      isFullScreen() { return win.fullScreen },
      isMinimized() { return win.minimized },
      isDestroyed() { return win.destroyed },
    })
    return win
  }

  it('saves shortly after the last move or resize, with the normal bounds when maximized', () => {
    vi.useFakeTimers()
    try {
      const file = path.join(tmp, 'track.json')
      const win = fakeWindow()
      trackWindowState(win, file, 400)
      win.emit('resize')
      win.bounds = { x: 30, y: 40, width: 1000, height: 750 }
      win.emit('move')
      vi.advanceTimersByTime(399)
      expect(fs.existsSync(file)).toBe(false)
      vi.advanceTimersByTime(1)
      expect(readWindowState(file)).toEqual({ bounds: win.bounds, maximized: false, fullScreen: false })
      win.maximized = true
      win.emit('maximize')
      vi.advanceTimersByTime(400)
      expect(readWindowState(file)).toEqual({ bounds: { x: 30, y: 40, width: 1000, height: 750 }, maximized: true, fullScreen: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves at once on close, and not while minimized', () => {
    const file = path.join(tmp, 'close.json')
    const win = fakeWindow()
    trackWindowState(win, file, 10_000)
    win.minimized = true
    win.emit('close')
    expect(fs.existsSync(file)).toBe(false)
    win.minimized = false
    win.fullScreen = true
    win.emit('close')
    expect(readWindowState(file)?.fullScreen).toBe(true)
  })
})
