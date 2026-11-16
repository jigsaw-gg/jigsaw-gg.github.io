/**
 * Landscape phones are held with both thumbs. The screen splits in half:
 * a pointer that starts on the left belongs to the left thumb, and the
 * right half belongs to the right thumb.
 *
 * Panning is a stick. The circle is as large as that thumb can travel
 * without leaving its half, and the board moves in the direction the
 * thumb leans, faster as the thumb nears the circle's border.
 */

import type { EdgeBounds } from './edgeCruise.ts'

export type ThumbSide = 'left' | 'right'
export type HandoverMarks = '>>>' | '<<<'

/** How long the thumb may rest past the split before the other thumb takes the piece. */
export const HANDOVER_MS = 2000
/** Past the midline by this much, the handover warning arms. */
export const HANDOVER_MARGIN = 12
/** Full lean, in viewport pixels per second. */
export const STICK_MAX_SPEED = 780
const STICK_MAX_RADIUS = 112
const STICK_MIN_RADIUS = 28
/** Fraction of the circle that does not move the board. */
const STICK_DEADZONE = 0.16

export function twoThumbLayout(
  mobile: boolean,
  width: number,
  height: number,
): boolean {
  return mobile && width > height && width >= 320 && height >= 200
}

export function thumbSide(localX: number, width: number): ThumbSide {
  return localX < width / 2 ? 'left' : 'right'
}

export function oppositeThumb(side: ThumbSide): ThumbSide {
  return side === 'left' ? 'right' : 'left'
}

export interface StickDisc {
  cx: number
  cy: number
  radius: number
}

/**
 * Circle centered on the touch. Its radius is the room left inside this
 * thumb's half, so the border is as far as that thumb can push the stick.
 */
export function stickDisc(
  localX: number,
  localY: number,
  width: number,
  height: number,
  side: ThumbSide,
): StickDisc {
  const mid = width / 2
  const left = side === 'left' ? 0 : mid
  const right = side === 'left' ? mid : width
  const room = Math.min(localX - left, right - localX, localY, height - localY)
  const cap = Math.min(STICK_MAX_RADIUS, Math.min(width, height) * 0.28)
  const radius = Math.min(
    Math.max(room, STICK_MIN_RADIUS),
    Math.max(cap, STICK_MIN_RADIUS),
  )
  return { cx: localX, cy: localY, radius }
}

export interface StickDeflection {
  x: number
  y: number
  /** 0 inside the dead zone, 1 when the thumb is on the border. */
  amount: number
  knobX: number
  knobY: number
}

export function stickDeflection(
  fingerX: number,
  fingerY: number,
  disc: StickDisc,
): StickDeflection {
  const dx = fingerX - disc.cx
  const dy = fingerY - disc.cy
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-4 || disc.radius <= 0) {
    return { x: 0, y: 0, amount: 0, knobX: disc.cx, knobY: disc.cy }
  }
  const nx = dx / dist
  const ny = dy / dist
  const clamped = Math.min(dist, disc.radius)
  const raw = clamped / disc.radius
  const amount =
    raw <= STICK_DEADZONE ? 0 : (raw - STICK_DEADZONE) / (1 - STICK_DEADZONE)
  return {
    x: amount === 0 ? 0 : nx,
    y: amount === 0 ? 0 : ny,
    amount,
    knobX: disc.cx + nx * clamped,
    knobY: disc.cy + ny * clamped,
  }
}

/**
 * The thumb has left its half. `>>>` means it crossed toward the right
 * thumb, `<<<` toward the left. Null while the thumb is still home.
 */
export function handoverMarks(
  side: ThumbSide,
  localX: number,
  width: number,
): HandoverMarks | null {
  const mid = width / 2
  if (side === 'left' && localX > mid + HANDOVER_MARGIN) return '>>>'
  if (side === 'right' && localX < mid - HANDOVER_MARGIN) return '<<<'
  return null
}

/**
 * Edge cruise for one thumb. The midline is the inner rim of that half,
 * the same kind of border as its top and bottom: nearing it scrolls the
 * table. Crossing it still hands the piece to the other thumb.
 */
export function halfEdgeBounds(
  bounds: EdgeBounds,
  side: ThumbSide,
): EdgeBounds {
  const mid = (bounds.left + bounds.right) / 2
  if (side === 'left') return { ...bounds, right: mid }
  return { ...bounds, left: mid }
}
