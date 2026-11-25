/**
 * Who may change which comments. Each function returns the part of `incoming`
 * the caller may merge into `current` (the result goes through mergeComments).
 */
import type { SharedComment } from '../../shared/hub-protocol.ts'

type Reply = NonNullable<SharedComment['replies']>[number]

const validReplies = (c: SharedComment): Reply[] =>
  (Array.isArray(c.replies) ? c.replies : []).filter((r) => r && typeof r.id === 'string' && r.id.length <= 64)

/** Legacy listen links: new comments, and new replies on existing ones. Edits to existing text are dropped. */
export function filterListenerComments(current: SharedComment[], incoming: SharedComment[]): SharedComment[] {
  const out: SharedComment[] = []
  for (const inc of incoming) {
    const existing = current.find((c) => c.id === inc.id)
    if (!existing) {
      out.push(inc)
      continue
    }
    const known = new Set((existing.replies ?? []).map((r) => r.id))
    const replies = validReplies(inc).filter((r) => !known.has(r.id))
    if (replies.length) out.push({ ...existing, replies: [...(existing.replies ?? []), ...replies] })
  }
  return out
}

/**
 * Space members: anyone may add comments and replies, which are stamped with
 * their member id (never the one in the body). A member may change only their
 * own comments and replies; the owner may change any. Authorship never changes.
 */
export function filterMemberComments(
  current: SharedComment[], incoming: SharedComment[], memberId: string, isOwner: boolean,
): SharedComment[] {
  const out: SharedComment[] = []
  for (const inc of incoming) {
    const existing = current.find((c) => c.id === inc.id)
    if (!existing) {
      const { replies: _r, ...fields } = inc
      const replies = validReplies(inc).map((r) => ({ ...r, authorMemberId: memberId }))
      out.push(replies.length ? { ...fields, authorMemberId: memberId, replies } : { ...fields, authorMemberId: memberId })
      continue
    }
    const replies = allowedReplies(existing, inc, memberId, isOwner)
    const mayEdit = isOwner || existing.authorMemberId === memberId
    const { replies: _drop, ...fields } = inc
    const base: SharedComment = mayEdit ? { ...fields, id: existing.id, authorMemberId: existing.authorMemberId } : { id: existing.id }
    if (!mayEdit && replies.length === 0) continue
    out.push(replies.length ? { ...base, replies } : base)
  }
  return out.map(dropUndefinedAuthor)
}

function allowedReplies(existing: SharedComment, inc: SharedComment, memberId: string, isOwner: boolean): Reply[] {
  const known = new Map((existing.replies ?? []).map((r) => [r.id, r] as const))
  const out: Reply[] = []
  for (const r of validReplies(inc)) {
    const prev = known.get(r.id)
    if (!prev) out.push({ ...r, authorMemberId: memberId })
    else if (isOwner || prev.authorMemberId === memberId) out.push({ ...r, authorMemberId: prev.authorMemberId })
  }
  return out
}

function dropUndefinedAuthor(c: SharedComment): SharedComment {
  if (c.authorMemberId !== undefined || !('authorMemberId' in c)) return c
  const { authorMemberId: _a, ...rest } = c
  return rest as SharedComment
}
