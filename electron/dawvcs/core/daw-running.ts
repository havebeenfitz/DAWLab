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
