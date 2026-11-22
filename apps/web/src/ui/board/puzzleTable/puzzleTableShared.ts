import type { CruiseBody } from './edgeCruise.ts'
import type { EdgeBounds } from './edgeCruise.ts'
import type { StickDisc, ThumbSide } from './twoThumb.ts'

/** How long the controller blink stays up after input starts. */
export const GAMEPAD_BLINK_MS = 3000
/** Stick must rest this long before a controller drag is saved. */
export const GAMEPAD_RELEASE_S = 0.12
export const MOBILE_LAYOUT = '(max-width: 1100px)'
/** How long the win banner and side decorations stay visible. */
export const WIN_CELEBRATE_MS = 3200
/** Ease the camera onto the finished puzzle over this many ms. */
export const WIN_CAMERA_MS = 900
/**
 * Critically damped snap, in rad/s. The piece speeds up toward the join,
 * then settles on it.
 */
export const SNAP_RESPONSE = 22

/** Comfortable inset so the finished board fills the view without crowding. */
export function winFitMargin(viewportW: number, viewportH: number): number {
  return Math.max(72, Math.min(viewportW, viewportH) * 0.1)
}

export interface SlideOffset {
  x: number
  y: number
  vx: number
  vy: number
}

export function allowsMotion(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function settleSlide(body: SlideOffset, dt: number): void {
  const response = SNAP_RESPONSE
  const decay = Math.exp(-response * dt)
  const carryX = body.vx + response * body.x
  const carryY = body.vy + response * body.y
  body.x = (body.x + carryX * dt) * decay
  body.y = (body.y + carryY * dt) * decay
  body.vx = (body.vx - response * carryX * dt) * decay
  body.vy = (body.vy - response * carryY * dt) * decay
}

export function slideResting(body: SlideOffset): boolean {
  return Math.hypot(body.x, body.y) < 0.2 && Math.hypot(body.vx, body.vy) < 4
}

export interface Drag {
  pointerId: number
  id: string
  group: string
  grabX: number
  grabY: number
  memberIds: Set<string>
  cruise: boolean
  clientX: number
  clientY: number
  thumb: ThumbSide | null
  handoverSince: number | null
}

export interface ActiveCruise {
  body: CruiseBody
  baseZoom: number
  anchorX: number
  anchorY: number
  lastTime: number
}

export interface Pan {
  pointerId: number
  x: number
  y: number
  stick: boolean
  side: ThumbSide | null
  disc: StickDisc | null
  fingerX: number
  fingerY: number
  last: number
}

export interface ScreenPoint {
  id: number
  x: number
  y: number
  target: EventTarget | null
}

export interface PinchSpan {
  dist: number
  x: number
  y: number
}

export function cruiseLive(
  cruise: ActiveCruise,
  pullSpeed: number,
  zoom: number,
): boolean {
  return (
    pullSpeed > 1 ||
    cruise.body.speed > 0.5 ||
    Math.abs(cruise.body.accel) > 1 ||
    Math.abs(zoom - cruise.baseZoom) > 1e-3
  )
}

export function touchEdgeBounds(
  fullscreen: boolean,
  canvas: DOMRect,
): EdgeBounds {
  if (!fullscreen) {
    return {
      left: canvas.left,
      top: canvas.top,
      right: canvas.right,
      bottom: canvas.bottom,
    }
  }
  const visual = window.visualViewport
  const left = visual?.offsetLeft ?? 0
  const top = visual?.offsetTop ?? 0
  const width = visual?.width ?? window.innerWidth
  const height = visual?.height ?? window.innerHeight
  return { left, top, right: left + width, bottom: top + height }
}

export function pinchSpan(points: readonly ScreenPoint[]): PinchSpan | null {
  const first = points[0]
  const second = points[1]
  if (!first || !second) return null
  return {
    dist: Math.hypot(second.x - first.x, second.y - first.y),
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

export function isScreenControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, label') !== null
  )
}

export function releaseCaptured(
  viewport: HTMLElement,
  point: ScreenPoint,
): void {
  const target = point.target
  if (target instanceof Element && target.hasPointerCapture(point.id)) {
    target.releasePointerCapture(point.id)
  }
  if (viewport.hasPointerCapture(point.id)) {
    viewport.releasePointerCapture(point.id)
  }
}
