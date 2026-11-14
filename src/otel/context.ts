import { nanoid } from 'nanoid'
import { SESSION_ID_ATTR, TAB_ID_ATTR } from './attrs.ts'

/** Stable for this document load; new tab / hard refresh gets a new id. */
export const TAB_ID = nanoid(21)

let puzzleSessionId: string | null = null

/** Attach (or clear) the puzzle session id on subsequent spans. */
export function setPuzzleSessionId(sessionId: string | null): void {
  puzzleSessionId = sessionId && sessionId.trim() ? sessionId.trim() : null
}

export function getPuzzleSessionId(): string | null {
  return puzzleSessionId
}

export function contextAttributes(): Record<string, string> {
  const attrs: Record<string, string> = { [TAB_ID_ATTR]: TAB_ID }
  if (puzzleSessionId) attrs[SESSION_ID_ATTR] = puzzleSessionId
  return attrs
}
