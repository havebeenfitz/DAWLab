import crypto from 'crypto'

/**
 * A new version id: the save time (YYYYMMDDHHMMSS, so ids still sort by time)
 * plus a random suffix, so two versions saved in the same second, on this Mac
 * or by collaborators on others, never get the same id. Older ids are the
 * bare timestamp and stay valid.
 */
export function newVersionId(timestamp: string, randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return `${timestamp}-${randomBytes(4).toString('hex')}`
}

/** The time part of a version id, old or new. */
export const versionIdTime = (id: string) => String(id).split('-')[0]
