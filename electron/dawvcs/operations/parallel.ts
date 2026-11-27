/**
 * "Make main" for a parallel version: the newest version of a fork
 * alternative becomes a new version on the alternative it split from, so that
 * line simply continues with it. Nothing is rewritten: the other person's
 * version stays where it is, and every Mac gets the change by syncing.
 */
import { loadLocalProjectLog, saveProjectLog, addCommitToLog } from '../core/log'
import { getCommitFileMap, saveCommit } from '../core/commits'
import { cleanDismissals } from '../../../shared/hub-protocol'
import { getProjectStorageDirs } from '../core/storage-location'
import { newVersionId } from '../core/version-id'
import { rollbackProject } from './rollback'
import { saveUnsavedWork } from './guard'

const stamp = () => new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)

export async function makeParallelVersionMain(projectName: string, forkBranch: string, author: string) {
  // The folder is about to get their version: keep yours first, or don't go on.
  const before = loadLocalProjectLog(projectName)
  const forkAuthor = (before?.branches ?? []).find((b: any) => b.name === forkBranch)?.forkOf?.author
  await saveUnsavedWork(projectName, `${forkAuthor ? `${forkAuthor}’s` : 'the parallel'} version`, author)
  const log = loadLocalProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not found`)
  const fork = (log.branches ?? []).find((b: any) => b.name === forkBranch)
  if (!fork?.forkOf) throw new Error(`'${forkBranch}' is not a parallel version.`)
  const target = (log.branches ?? []).find((b: any) => b.name === fork.forkOf.branch)
  if (!target) throw new Error(`The alternative '${fork.forkOf.branch}' no longer exists.`)
  const byTime = (a: any, b: any) => String(a.timestamp).localeCompare(String(b.timestamp))
  const tip = [...(fork.commits ?? [])].sort(byTime).pop()
  if (!tip) throw new Error(`'${forkBranch}' has no versions.`)
  const targetTip = [...(target.commits ?? [])].sort(byTime).pop()

  const { commitsDir } = getProjectStorageDirs(projectName)
  const timestamp = stamp()
  const commitId = newVersionId(timestamp)
  saveCommit(projectName, commitId, getCommitFileMap(projectName, String(tip.commit_id), commitsDir), commitsDir)
  addCommitToLog(log, target.name, {
    commit_id: commitId,
    timestamp,
    message: `${fork.forkOf.author ? `${fork.forkOf.author}’s` : 'Parallel'} version made main: ${tip.message}`,
    author,
    ...(targetTip ? { parent: String(targetTip.commit_id) } : {}),
    merged_from: String(tip.commit_id),
    ...(tip.preview_file ? { preview_file: tip.preview_file } : {}),
  })
  log.current_branch = target.name
  saveProjectLog(projectName, log)
  // Put the project folder on the new main version.
  await rollbackProject(projectName, commitId)
  return { commitId, branch: target.name }
}

/**
 * Hides the "parallel version" notice for the fork's current version, for you,
 * with a reason. The alternative stays (for everyone); the reason syncs with
 * the log, and its author sees it on the version's parallel-version notice.
 */
export function dismissParallelVersion(projectName: string, forkBranch: string, by: string, comment: string) {
  const text = String(comment ?? '').trim()
  if (!text) throw new Error('Say in a few words why, so the other person knows.')
  if (text.length > 1000) throw new Error('Keep the reason under 1000 characters.')
  const who = String(by ?? '').trim()
  if (!who) throw new Error('Set your name in Settings first.')
  const log = loadLocalProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not found`)
  const fork = (log.branches ?? []).find((b: any) => b.name === forkBranch)
  if (!fork?.forkOf) throw new Error(`'${forkBranch}' is not a parallel version.`)
  const byTime = (a: any, b: any) => String(a.timestamp).localeCompare(String(b.timestamp))
  const tip = [...(fork.commits ?? [])].sort(byTime).pop()
  if (!tip) throw new Error(`'${forkBranch}' has no versions.`)

  const at = new Date().toISOString()
  fork.dismissed = cleanDismissals([...(fork.dismissed ?? []), { by: who, tip: String(tip.commit_id), at, comment: text }])
  saveProjectLog(projectName, log)

  return { tip: String(tip.commit_id) }
}

