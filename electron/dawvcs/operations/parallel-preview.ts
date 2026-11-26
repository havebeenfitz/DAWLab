/**
 * "Preview whole project" for a parallel version: lays that version out into
 * its own folder in DAWLab's data ("<song> (preview · bob)"), so it can be
 * opened in the DAW without ever touching your working folder. "Back to mine"
 * moves that folder to the Trash. One preview per project at a time.
 */
import fs from 'fs'
import path from 'path'
import { loadLocalProjectLog } from '../core/log'
import { getProjectPath } from '../core/registry'
import { getUserDir } from '../core/constants'
import { writeJsonSync } from '../core/fs-utils'
import type { TrashFn } from '../core/trash'
import { rollbackProject } from './rollback'

export interface ParallelPreview {
  projectName: string
  branch: string
  commitId: string
  author: string
  message: string
  /** The folder the version was laid out in. */
  path: string
}

const file = () => path.join(getUserDir(), 'previews.json')

function readAll(): Record<string, ParallelPreview> {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, ParallelPreview>
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, ParallelPreview>) {
  fs.mkdirSync(getUserDir(), { recursive: true })
  writeJsonSync(file(), all)
}

/** The open preview of a project, if its folder still exists. */
export function getParallelPreview(projectName: string): ParallelPreview | null {
  const p = readAll()[projectName]
  return p && fs.existsSync(p.path) ? p : null
}

const safe = (s: string) => String(s || '').replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').trim().slice(0, 60) || 'someone'

/** Lays the newest version of `branch` out next to the project. Replaces an open preview of the same project. */
export async function startParallelPreview(projectName: string, branch: string, trash: TrashFn): Promise<ParallelPreview> {
  const log = loadLocalProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not found`)
  const fork = (log.branches ?? []).find((b: any) => b.name === branch)
  if (!fork) throw new Error(`The alternative '${branch}' no longer exists.`)
  const byTime = (a: any, b: any) => String(a.timestamp).localeCompare(String(b.timestamp))
  const tip = [...(fork.commits ?? [])].sort(byTime).pop()
  if (!tip) throw new Error(`'${branch}' has no versions.`)
  const projectPath = getProjectPath(projectName)
  if (!projectPath || projectPath === 'NA' || projectPath === '/') throw new Error(`'${projectName}' has no project folder on this Mac.`)

  await endParallelPreview(projectName, trash)
  const author = String(fork.forkOf?.author || tip.author || '')
  // In DAWLab's own folder, never next to the project: a shared or watched folder must not see it.
  const base = path.join(getUserDir(), 'previews', safe(projectName), `${path.basename(projectPath)} (preview · ${safe(author || branch)})`)
  let target = base
  for (let i = 2; fs.existsSync(target); i++) target = `${base} ${i}`
  if (path.resolve(target) === path.resolve(projectPath)) throw new Error('Refusing to preview into the project folder.')

  fs.mkdirSync(target, { recursive: true })
  try {
    await rollbackProject(projectName, String(tip.commit_id), target)
  } catch (err) {
    fs.rmSync(target, { recursive: true, force: true })
    throw err
  }
  const preview: ParallelPreview = {
    projectName, branch, commitId: String(tip.commit_id), author, message: String(tip.message ?? ''), path: target,
  }
  writeAll({ ...readAll(), [projectName]: preview })
  return preview
}

/** Keeps an open preview with its project after a rename. */
export function renameParallelPreview(oldName: string, newName: string) {
  const all = readAll()
  if (!all[oldName] || oldName === newName) return
  const { [oldName]: p, ...rest } = all
  writeAll({ ...rest, [newName]: { ...p, projectName: newName } })
}

/** Closes the preview: its folder goes to the Trash. Your project folder is never touched. */
export async function endParallelPreview(projectName: string, trash: TrashFn): Promise<void> {
  const all = readAll()
  const p = all[projectName]
  if (!p) return
  const projectPath = getProjectPath(projectName)
  if (fs.existsSync(p.path) && (!projectPath || path.resolve(p.path) !== path.resolve(projectPath))) await trash(p.path)
  const { [projectName]: _gone, ...rest } = all
  writeAll(rest)
}
