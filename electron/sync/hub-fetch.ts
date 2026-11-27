/**
 * fetch for talking to a hub, with a deadline, so a request the network or
 * the hub never answers fails instead of leaving a sync "Syncing..." forever.
 *
 * Plain requests get a fixed deadline. File transfers get a stall watchdog
 * instead: they may take as long as they need, but fail when no bytes have
 * moved for STALL_MS.
 */
export const REQUEST_TIMEOUT_MS = 60_000
export const STALL_MS = 90_000

export function hubFetch(url: string, init: RequestInit & { duplex?: 'half' } = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
}

/** An abort signal that fires when `touch` hasn't been called for `ms`. Call `done` when the transfer ends. */
export function stallWatchdog(ms = STALL_MS) {
  const ctrl = new AbortController()
  let timer = setTimeout(fire, ms)
  function fire() {
    ctrl.abort(new Error('The connection to the DAWLab server stalled. It will try again.'))
  }
  return {
    signal: ctrl.signal,
    touch() {
      clearTimeout(timer)
      timer = setTimeout(fire, ms)
    },
    done() {
      clearTimeout(timer)
    },
  }
}
