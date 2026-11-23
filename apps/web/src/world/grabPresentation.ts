import type { MotionPacket } from './motion.ts'
import type { Placement } from './placement.ts'

/** Wire held anchor still matches resting board (not dragged on wire yet). */
export const HELD_AT_REST_PX = 48
/** Cursor plausibly at the held anchor (rejects re-entry at screen edge). */
export const GRAB_OFFSET_TRUST_PX = 420

export function grabOffsetTrustworthy(
  held: MotionPacket,
  cursor: MotionPacket,
): boolean {
  if (held.hide || cursor.hide) return false
  return (
    Math.hypot(cursor.x - held.x, cursor.y - held.y) <= GRAB_OFFSET_TRUST_PX
  )
}

export function grabPickAtRest(
  resting: Placement,
  offsetX: number,
  offsetY: number,
): { x: number; y: number } {
  return { x: resting.x - offsetX, y: resting.y - offsetY }
}
