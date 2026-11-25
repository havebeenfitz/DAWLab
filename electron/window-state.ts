/**
 * Remembers the main window's size and position between launches.
 * The pure parts (parse, fit to the screens) are separate from Electron so they can be tested.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface Rect { x: number; y: number; width: number; height: number }

export interface WindowState {
  bounds: Rect
  maximized: boolean
  fullScreen: boolean
}

/** The window can't be made smaller than this. */
export const MIN_SIZE = { width: 720, height: 480 }
/** First launch: this share of the screen, centred. */
const DEFAULT_SHARE = { width: 0.52, height: 0.5 }
/** How much of the title bar must be on a screen for the window to count as visible. */
const MIN_VISIBLE = 80
const SAVE_DELAY_MS = 400

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A saved state, or null when the file is missing, broken or nonsense. */
export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, any>
  const b = r.bounds
  if (!b || ![b.x, b.y, b.width, b.height].every(isNum) || b.width <= 0 || b.height <= 0) return null
  return {
    bounds: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) },
    maximized: r.maximized === true,
    fullScreen: r.fullScreen === true,
  }
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/**
 * Fits saved bounds to the screens there are now: kept as they are when the title
 * bar is reachable on some screen, otherwise shrunk to and centred on the screen
 * it overlapped most (the first one when it is on none, e.g. a monitor was unplugged).
 */
export function fitToDisplays(bounds: Rect, workAreas: Rect[]): Rect {
  if (workAreas.length === 0) return bounds
  const titleBar: Rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: 30 }
  const reachable = workAreas.some((a) => overlap(titleBar, a) >= Math.min(MIN_VISIBLE, bounds.width) * titleBar.height)
  const best = [...workAreas].sort((a, b) => overlap(bounds, b) - overlap(bounds, a))[0]
  const width = Math.max(MIN_SIZE.width, Math.min(bounds.width, best.width))
  const height = Math.max(MIN_SIZE.height, Math.min(bounds.height, best.height))
  if (reachable && width === bounds.width && height === bounds.height) return bounds
  if (reachable) return { ...bounds, width, height }
  return {
    x: best.x + Math.round((best.width - width) / 2),
    y: best.y + Math.round((best.height - height) / 2),
    width,
    height,
  }
}

/** First-launch size: about half the screen, centred, never under the minimum. */
export function defaultBounds(workArea: Rect): Rect {
  const width = Math.min(workArea.width, Math.max(MIN_SIZE.width, Math.round(workArea.width * DEFAULT_SHARE.width)))
  const height = Math.min(workArea.height, Math.max(MIN_SIZE.height, Math.round(workArea.height * DEFAULT_SHARE.height)))
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  }
}

/** Where the window opens: the saved place fitted to today's screens, else the default. */
export function initialWindowState(saved: WindowState | null, workAreas: Rect[], primary: Rect): WindowState {
  if (!saved) return { bounds: defaultBounds(primary), maximized: false, fullScreen: false }
  return { ...saved, bounds: fitToDisplays(saved.bounds, workAreas.length ? workAreas : [primary]) }
}

export function readWindowState(file: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

export function writeWindowState(file: string, state: WindowState) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, file)
  } catch (err) {
    console.warn('[window-state] Could not save the window position:', err)
  }
}

/** The parts of a BrowserWindow this needs. */
export interface TrackedWindow {
  getNormalBounds(): Rect
  isMaximized(): boolean
  isFullScreen(): boolean
  isMinimized(): boolean
  isDestroyed(): boolean
  on(event: string, listener: () => void): unknown
}

/**
 * Saves the window's state shortly after it is moved, resized, maximized or put
 * in full screen, and right away when it closes. Saves the normal (un-maximized)
 * bounds so un-maximizing after a relaunch goes back to the size you had.
 */
export function trackWindowState(win: TrackedWindow, file: string, delayMs = SAVE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (win.isDestroyed() || win.isMinimized()) return
    writeWindowState(file, { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullScreen: win.isFullScreen() })
  }
  const later = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, delayMs)
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, later)
  win.on('close', save)
  return { save }
}
