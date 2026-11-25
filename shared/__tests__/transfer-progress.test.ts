import { describe, it, expect } from 'vitest'
import { createTransferTracker, formatTransferBytes, transferPercent, describeTransfer, type TransferProgress } from '../transfer-progress'

const MB = 1024 * 1024

function track(files: Array<{ size?: number | null; name?: string }>, intervalMs = 100) {
  let t = 0
  const events: TransferProgress[] = []
  const tracker = createTransferTracker('download', files, (p) => events.push(p), { intervalMs, now: () => t })
  return { tracker, events, advance: (ms: number) => { t += ms } }
}

describe('transfer progress', () => {
  it('adds up bytes across files and knows which file is moving', () => {
    const { tracker, events } = track([{ size: 10 * MB, name: 'kick.wav' }, { size: 30 * MB, name: 'vox.wav' }])
    tracker.startFile(0)
    expect(events.at(-1)).toMatchObject({ fileIndex: 1, fileCount: 2, fileName: 'kick.wav', bytesDone: 0, bytesTotal: 40 * MB })
    tracker.addBytes(10 * MB)
    tracker.startFile(1)
    tracker.addBytes(5 * MB)
    tracker.flush()
    expect(events.at(-1)).toMatchObject({ fileIndex: 2, fileName: 'vox.wav', bytesDone: 15 * MB, bytesTotal: 40 * MB })
  })

  it('sends at most one event per interval, but always the file start and the end', () => {
    const { tracker, events, advance } = track([{ size: 1000 }], 100)
    tracker.startFile(0) // 1
    for (let i = 0; i < 50; i++) { tracker.addBytes(10); advance(10) } // 500 ms of chunks
    expect(events.length).toBeGreaterThanOrEqual(5)
    expect(events.length).toBeLessThanOrEqual(7)
    tracker.flush()
    expect(events.at(-1)!.bytesDone).toBe(500)
  })

  it('learns sizes it wasn\'t told up front and never shows more done than total', () => {
    const { tracker, events } = track([{ size: null, name: 'a' }, { size: 100, name: 'b' }])
    tracker.startFile(0)
    expect(events.at(-1)!.bytesTotal).toBe(100)
    tracker.knowSize(300)
    tracker.addBytes(350) // the server sent more than it said
    tracker.flush()
    expect(events.at(-1)).toMatchObject({ bytesDone: 350, bytesTotal: 400 })
    expect(transferPercent(events.at(-1)!)).toBe(87)
  })

  it('formats like "12.4 of 126 MB" and small ones in KB', () => {
    expect(formatTransferBytes(13 * MB, 126 * MB)).toBe('13 of 126 MB')
    expect(formatTransferBytes(12.4 * MB, 126 * MB)).toBe('12.4 of 126 MB')
    expect(formatTransferBytes(300 * 1024, 900 * 1024)).toBe('300 of 900 KB')
    expect(formatTransferBytes(2 * MB, 1 * MB)).toBe('1 of 1 MB')
    expect(transferPercent({ bytesDone: 0, bytesTotal: 0 })).toBe(0)
    expect(transferPercent({ bytesDone: 99.9, bytesTotal: 100 })).toBe(99)
  })

  it('describes the transfer in one line', () => {
    expect(describeTransfer({ phase: 'download', fileIndex: 3, fileCount: 12, fileName: 'kick.wav', bytesDone: 12.4 * MB, bytesTotal: 126 * MB }))
      .toBe('Downloading kick.wav · 3 of 12 · 12.4 of 126 MB')
    expect(describeTransfer({ phase: 'upload', fileIndex: 1, fileCount: 1, bytesDone: 0, bytesTotal: 2048 }))
      .toBe('Uploading · 0 of 2 KB')
  })
})
