/**
 * Lays out a project's alternatives as a git-like graph: one lane per
 * alternative (main on top), versions left to right by time, and a line from
 * each version to the one it was saved on top of, also across lanes (where an
 * alternative or a parallel version split off). Pure: used by the History view and tests.
 */

export interface GraphCommit {
  commit_id: string
  timestamp: string
  message?: string
  author?: string
  parent?: string
  merged_from?: string
  auto?: boolean
}

export interface GraphBranch {
  name: string
  commits: GraphCommit[]
  forkOf?: { branch: string; parent: string; author: string }
}

export interface GraphNode {
  id: string
  lane: number
  /** Column: position of the version in time across all alternatives. */
  col: number
  message: string
  author: string
  auto: boolean
  current: boolean
}

export interface GraphEdge {
  from: string
  to: string
  kind: 'line' | 'fork' | 'merge'
}

export interface GraphLane {
  name: string
  /** A parallel version someone else saved, not an alternative made on purpose. */
  parallel: boolean
  /** Index into LANE_COLORS. */
  color: number
}

export interface BranchGraph {
  lanes: GraphLane[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  columns: number
}

export const LANE_COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#a3e635']

const byTime = (a: GraphCommit, b: GraphCommit) =>
  String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.commit_id).localeCompare(String(b.commit_id))

export function layoutBranchGraph(branches: GraphBranch[], currentId?: string | null): BranchGraph {
  const live = branches.filter((b) => (b.commits ?? []).length > 0)
  // main first, then alternatives by when they started.
  const firstTime = (b: GraphBranch) => [...b.commits].sort(byTime)[0]?.timestamp ?? ''
  const ordered = [...live].sort((a, b) =>
    (a.name === 'main' ? -1 : b.name === 'main' ? 1 : 0) || String(firstTime(a)).localeCompare(String(firstTime(b))),
  )
  const lanes: GraphLane[] = ordered.map((b, i) => ({ name: b.name, parallel: !!b.forkOf, color: i % LANE_COLORS.length }))
  const laneOf = new Map<string, number>()
  const all: Array<GraphCommit & { lane: number }> = []
  ordered.forEach((b, lane) => {
    for (const c of b.commits) {
      const id = String(c.commit_id)
      if (laneOf.has(id)) continue
      laneOf.set(id, lane)
      all.push({ ...c, lane })
    }
  })
  all.sort(byTime)

  const nodes: GraphNode[] = all.map((c, col) => ({
    id: String(c.commit_id), lane: c.lane, col,
    message: String(c.message ?? ''), author: String(c.author ?? ''), auto: !!c.auto, current: String(c.commit_id) === currentId,
  }))

  const edges: GraphEdge[] = []
  ordered.forEach((b, lane) => {
    const commits = [...b.commits].sort(byTime).filter((c) => laneOf.get(String(c.commit_id)) === lane)
    commits.forEach((c, i) => {
      const id = String(c.commit_id)
      const parent = c.parent && laneOf.has(String(c.parent)) ? String(c.parent)
        : i === 0 && b.forkOf && laneOf.has(b.forkOf.parent) ? b.forkOf.parent
        : i > 0 ? String(commits[i - 1].commit_id) : null
      if (parent) edges.push({ from: parent, to: id, kind: laneOf.get(parent) === lane ? 'line' : 'fork' })
      if (c.merged_from && laneOf.has(String(c.merged_from))) edges.push({ from: String(c.merged_from), to: id, kind: 'merge' })
    })
  })
  return { lanes, nodes, edges, columns: nodes.length }
}
