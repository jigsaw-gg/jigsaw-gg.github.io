import { SESSION_ELAPSED_MS_ATTR } from './attrs.ts'

/** Format authoritative server session clock as `minutes:seconds.fff`. */
export function formatServerSessionTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms))
  const minutes = Math.floor(clamped / 60_000)
  const withinMinute = clamped % 60_000
  const seconds = Math.floor(withinMinute / 1000)
  const frac = withinMinute % 1000
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(frac).padStart(3, '0')}`
}

export type ServerSessionClock = {
  elapsedMs: number
  receivedAt: number
}

let serverSessionClock: ServerSessionClock | null = null
const clockListeners = new Set<() => void>()

/** Update from `ServerEnvelope.session_elapsed_ms` (authoritative). */
export function setServerSessionElapsedMs(elapsedMs: number | null): void {
  if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    if (serverSessionClock === null) return
    serverSessionClock = null
    for (const listener of clockListeners) listener()
    return
  }
  const rounded = Math.floor(elapsedMs)
  const next: ServerSessionClock = {
    elapsedMs: rounded,
    receivedAt: performance.now(),
  }
  if (
    serverSessionClock &&
    serverSessionClock.elapsedMs === next.elapsedMs &&
    Math.abs(serverSessionClock.receivedAt - next.receivedAt) < 0.5
  ) {
    return
  }
  serverSessionClock = next
  for (const listener of clockListeners) listener()
}

export function getServerSessionElapsedMs(
  now = performance.now(),
): number | null {
  if (!serverSessionClock) return null
  return Math.floor(
    serverSessionClock.elapsedMs + (now - serverSessionClock.receivedAt),
  )
}

export function subscribeServerSessionClock(listener: () => void): () => void {
  clockListeners.add(listener)
  return () => {
    clockListeners.delete(listener)
  }
}

/** Smooth overlay display between ~10 Hz wire updates. */
export function subscribeSessionTimeDisplay(listener: () => void): () => void {
  let frame = 0
  const stopFrame = () => {
    if (frame) {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
  }
  const startFrame = () => {
    stopFrame()
    if (!serverSessionClock) return
    const tick = () => {
      listener()
      if (serverSessionClock) {
        frame = window.requestAnimationFrame(tick)
      }
    }
    frame = window.requestAnimationFrame(tick)
  }
  const unsubClock = subscribeServerSessionClock(() => {
    listener()
    if (serverSessionClock) startFrame()
    else stopFrame()
  })
  if (serverSessionClock) startFrame()
  return () => {
    unsubClock()
    stopFrame()
  }
}

export function getSessionTimeDisplay(): string | null {
  const ms = getServerSessionElapsedMs()
  if (ms === null) return null
  return formatServerSessionTime(ms)
}

/** Scalar attribute for OTEL spans (last wire value at span creation). */
export function sessionTimeAttributes(): Record<string, number> {
  const ms = serverSessionClock?.elapsedMs
  if (ms === undefined) return {}
  return { [SESSION_ELAPSED_MS_ATTR]: ms }
}
