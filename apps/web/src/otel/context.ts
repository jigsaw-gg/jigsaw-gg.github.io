import { createUlidLikeId } from '../core/id.ts'
import { SESSION_ID_ATTR, TAB_ID_ATTR, TRANSPORT_ATTR } from './attrs.ts'
import { buildMetaAttributes } from './buildMeta.ts'
import { sessionTimeAttributes } from './sessionTime.ts'

/** Stable for this document load; new tab / hard refresh gets a new id. */
export const TAB_ID = createUlidLikeId()

export type PlayTransportLabel = 'webtransport' | 'websocket'

let puzzleSessionId: string | null = null
const sessionListeners = new Set<() => void>()

let playTransport: PlayTransportLabel | null = null
const transportListeners = new Set<() => void>()

/** Attach (or clear) the puzzle session id on subsequent spans. */
export function setPuzzleSessionId(sessionId: string | null): void {
  const next = sessionId && sessionId.trim() ? sessionId.trim() : null
  if (next === puzzleSessionId) return
  puzzleSessionId = next
  for (const listener of sessionListeners) listener()
}

export function getPuzzleSessionId(): string | null {
  return puzzleSessionId
}

/** React / UI subscription when the play session id is set or cleared. */
export function subscribePuzzleSessionId(listener: () => void): () => void {
  sessionListeners.add(listener)
  return () => {
    sessionListeners.delete(listener)
  }
}

/** Attach (or clear) the live play transport for debug overlay + span attrs. */
export function setPlayTransport(transport: PlayTransportLabel | null): void {
  if (transport === playTransport) return
  playTransport = transport
  for (const listener of transportListeners) listener()
}

export function getPlayTransport(): PlayTransportLabel | null {
  return playTransport
}

export function subscribePlayTransport(listener: () => void): () => void {
  transportListeners.add(listener)
  return () => {
    transportListeners.delete(listener)
  }
}

export function contextAttributes(): Record<string, string | number> {
  const attrs: Record<string, string | number> = { [TAB_ID_ATTR]: TAB_ID }
  Object.assign(attrs, buildMetaAttributes())
  if (puzzleSessionId) attrs[SESSION_ID_ATTR] = puzzleSessionId
  if (playTransport) attrs[TRANSPORT_ATTR] = playTransport
  Object.assign(attrs, sessionTimeAttributes())
  return attrs
}
