/** Best-effort: is the DAW for a project running right now? Used to warn before files are replaced. */
import { execFile } from 'child_process'

const APPS: Array<{ match: RegExp; name: string; daw: RegExp }> = [
  { match: /\/Logic Pro[^/]*\.app\/Contents\/MacOS\//, name: 'Logic Pro', daw: /logic/i },
  { match: /\/Ableton Live[^/]*\.app\/Contents\/MacOS\//, name: 'Ableton Live', daw: /ableton|live/i },
]

/** The running app among `commands` (full executable paths, as `ps -axo comm=` prints them) that opens `daw` projects. */
export function dawAppIn(commands: string[], daw: string | undefined): string | null {
  for (const app of APPS) {
    if (daw && !app.daw.test(daw)) continue
    if (commands.some((c) => app.match.test(c))) return app.name
  }
  return null
}

export function runningDawApp(daw: string | undefined): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'comm='], { timeout: 3000 }, (err, stdout) => {
      resolve(err ? null : dawAppIn(String(stdout).split('\n'), daw))
    })
  })
}

export interface DawProjectState {
  /** "Logic Pro" / "Ableton Live" when that app is running, else null. */
  app: string | null
  /** True when the app has files of this project open right now: the project is open in it. */
  holdsFiles: boolean
}

function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err && !stdout ? null : String(stdout)))
  })
}

/** Process ids of the running app among `ps -axo pid=,comm=` lines. */
export function dawPidsIn(lines: string[], daw: string | undefined): { app: string | null; pids: number[] } {
  for (const app of APPS) {
    if (daw && !app.daw.test(daw)) continue
    const pids = lines
      .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m && app.match.test(m[2]))
      .map((m) => Number(m[1]))
    if (pids.length) return { app: app.name, pids }
  }
  return { app: null, pids: [] }
}

/** True when `lsof -Fn` output names a file inside `folder`. */
export function lsofHoldsFolder(output: string, folder: string): boolean {
  const root = folder.replace(/\/+$/, '') + '/'
  return output.split('\n').some((l) => l.startsWith('n') && l.slice(1).startsWith(root))
}

/**
 * Is the project open in its DAW? The app running is known for sure; whether
 * it has this project open is known when it holds the project's files (Logic
 * keeps the audio of an open project open). Best effort, macOS only.
 */
export async function dawProjectState(projectPath: string, daw: string | undefined): Promise<DawProjectState> {
  if (process.platform !== 'darwin') return { app: null, holdsFiles: false }
  const ps = await run('ps', ['-axo', 'pid=,comm='], 3000)
  if (!ps) return { app: null, holdsFiles: false }
  const { app, pids } = dawPidsIn(ps.split('\n'), daw)
  if (!app) return { app: null, holdsFiles: false }
  const out = await run('lsof', ['-Fn', '-p', pids.join(',')], 5000)
  return { app, holdsFiles: !!out && lsofHoldsFolder(out, projectPath) }
}
