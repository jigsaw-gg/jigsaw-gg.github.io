import {
  fitCamera,
  zoomCamera,
  type Bounds,
  type Camera,
  type Placement,
} from './play.ts'

/** Full stick places the point of interest this many viewports from the group. */
export const LOOK_VIEWPORTS = 1.5
/** Screen pixels per second at full left-stick deflection. */
export const PIECE_SPEED_PX = 700
/** Viewport pixels per second for the hover pointer (unselected). */
export const POINTER_SPEED_PX = 900
/** Viewport pixels per second for right-stick pan (unselected). */
export const PAN_SPEED_PX = 900
/** Natural log of zoom per second at a full trigger. */
export const TRIGGER_ZOOM_PER_SEC = 0.7
export const VIEW_MARGIN = 32

export interface GroupAnchor {
  group: string
  id: string
}

export function groupAnchors(placements: readonly Placement[]): GroupAnchor[] {
  const best = new Map<string, Placement>()
  for (const piece of placements) {
    const current = best.get(piece.group)
    if (
      !current ||
      piece.y < current.y ||
      (piece.y === current.y && piece.x < current.x) ||
      (piece.y === current.y && piece.x === current.x && piece.id < current.id)
    ) {
      best.set(piece.group, piece)
    }
  }
  return [...best.values()]
    .sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y
      if (a.x !== b.x) return a.x - b.x
      if (a.id < b.id) return -1
      if (a.id > b.id) return 1
      return 0
    })
    .map((piece) => ({ group: piece.group, id: piece.id }))
}

export function cycleAnchor(
  anchors: readonly GroupAnchor[],
  currentGroup: string | null,
  direction: -1 | 1,
): GroupAnchor | null {
  if (anchors.length === 0) return null
  const index =
    currentGroup === null
      ? -1
      : anchors.findIndex((item) => item.group === currentGroup)
  const start = index < 0 ? (direction > 0 ? -1 : 0) : index
  const next = (start + direction + anchors.length) % anchors.length
  return anchors[next] ?? null
}

export type PadDirection = 'left' | 'right' | 'up' | 'down'

interface ScreenPoint {
  x: number
  y: number
}

/** Screen-space center of a group's cell bounds. */
export function groupScreenCenter(
  placements: readonly Placement[],
  group: string,
  cellW: number,
  cellH: number,
  camera: Camera,
): ScreenPoint | null {
  const bounds = groupWorldBounds(placements, group, cellW, cellH)
  if (!bounds || !(camera.zoom > 0)) return null
  const worldX = (bounds.minX + bounds.maxX) / 2
  const worldY = (bounds.minY + bounds.maxY) / 2
  return {
    x: worldX * camera.zoom + camera.x,
    y: worldY * camera.zoom + camera.y,
  }
}

/** Direction unit for screen space (y grows downward). */
export function padDirectionAxis(direction: PadDirection): ScreenPoint {
  if (direction === 'left') return { x: -1, y: 0 }
  if (direction === 'right') return { x: 1, y: 0 }
  if (direction === 'up') return { x: 0, y: -1 }
  return { x: 0, y: 1 }
}

/**
 * Spatial pick among screen points: prefer nearest target ahead in
 * `direction` with small sideways offset (how a player expects D-pad to feel).
 */
export function pickScreenTargetInDirection<T>(
  candidates: readonly { id: T; x: number; y: number }[],
  from: ScreenPoint,
  currentId: T | null,
  direction: PadDirection,
): T | null {
  const axis = padDirectionAxis(direction)
  let best: T | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (currentId !== null && candidate.id === currentId) continue
    const dx = candidate.x - from.x
    const dy = candidate.y - from.y
    const forward = dx * axis.x + dy * axis.y
    if (forward <= 4) continue
    const sideways = Math.abs(dx * axis.y - dy * axis.x)
    const score = forward + (sideways * sideways) / Math.max(forward, 1)
    if (score < bestScore) {
      bestScore = score
      best = candidate.id
    }
  }
  return best
}

/**
 * Pick the group the player would expect for a D-pad press: among groups
 * that lie in that screen direction from the focus, prefer the nearest that
 * is also well aligned (small sideways offset relative to forward distance).
 */
export function pickGroupInDirection(
  placements: readonly Placement[],
  cellW: number,
  cellH: number,
  camera: Camera,
  from: ScreenPoint,
  currentGroup: string | null,
  direction: PadDirection,
): GroupAnchor | null {
  const candidates: { id: GroupAnchor; x: number; y: number }[] = []
  for (const anchor of groupAnchors(placements)) {
    if (anchor.group === currentGroup) continue
    const center = groupScreenCenter(
      placements,
      anchor.group,
      cellW,
      cellH,
      camera,
    )
    if (!center) continue
    candidates.push({ id: anchor, x: center.x, y: center.y })
  }
  return pickScreenTargetInDirection(candidates, from, null, direction)
}

/** Topmost group under a world point (cell hit boxes). Prefer `preferGroup`. */
export function groupAtWorld(
  placements: readonly Placement[],
  worldX: number,
  worldY: number,
  cellW: number,
  cellH: number,
  preferGroup: string | null = null,
): GroupAnchor | null {
  let best: Placement | null = null
  let bestScore = -1
  for (const piece of placements) {
    if (
      worldX < piece.x ||
      worldY < piece.y ||
      worldX >= piece.x + cellW ||
      worldY >= piece.y + cellH
    ) {
      continue
    }
    const score = piece.group === preferGroup ? 2 : 1
    if (!best || score > bestScore) {
      best = piece
      bestScore = score
    }
  }
  return best ? { group: best.group, id: best.id } : null
}

export function groupWorldBounds(
  placements: readonly Placement[],
  group: string,
  cellW: number,
  cellH: number,
): Bounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let found = false
  for (const piece of placements) {
    if (piece.group !== group) continue
    found = true
    minX = Math.min(minX, piece.x)
    minY = Math.min(minY, piece.y)
    maxX = Math.max(maxX, piece.x + cellW)
    maxY = Math.max(maxY, piece.y + cellH)
  }
  if (!found) return null
  return { minX, minY, maxX, maxY }
}

export function piecesVisible(
  camera: Camera,
  viewportW: number,
  viewportH: number,
  placements: readonly Placement[],
  cellW: number,
  cellH: number,
  slop = 1.5,
): boolean {
  if (!(camera.zoom > 0) || placements.length === 0) return false
  for (const piece of placements) {
    const x0 = piece.x * camera.zoom + camera.x
    const y0 = piece.y * camera.zoom + camera.y
    const x1 = (piece.x + cellW) * camera.zoom + camera.x
    const y1 = (piece.y + cellH) * camera.zoom + camera.y
    if (
      x0 < -slop ||
      y0 < -slop ||
      x1 > viewportW + slop ||
      y1 > viewportH + slop
    ) {
      return false
    }
  }
  return true
}

export function boundsVisible(
  camera: Camera,
  viewportW: number,
  viewportH: number,
  bounds: Bounds,
  slop = 1.5,
): boolean {
  if (!(camera.zoom > 0)) return false
  const x0 = bounds.minX * camera.zoom + camera.x
  const y0 = bounds.minY * camera.zoom + camera.y
  const x1 = bounds.maxX * camera.zoom + camera.x
  const y1 = bounds.maxY * camera.zoom + camera.y
  return (
    x0 >= -slop &&
    y0 >= -slop &&
    x1 <= viewportW + slop &&
    y1 <= viewportH + slop
  )
}

/** World offset of the point of interest from the selected group center. */
export function lookOffset(
  stickX: number,
  stickY: number,
  viewportW: number,
  viewportH: number,
  zoom: number,
): { x: number; y: number } {
  const safe = Math.max(zoom, 0.0001)
  return {
    x: (stickX * LOOK_VIEWPORTS * viewportW) / safe,
    y: (stickY * LOOK_VIEWPORTS * viewportH) / safe,
  }
}

/**
 * Shift the follow camera toward the point of interest. Zoom out, only as
 * far as needed, when the group and that point no longer fit together.
 * A zero offset returns the follow camera unchanged.
 */
export function cameraWithInterest(
  follow: Camera,
  piece: Bounds,
  offsetX: number,
  offsetY: number,
  viewportW: number,
  viewportH: number,
  minZoom: number,
  margin = VIEW_MARGIN,
): Camera {
  const zoomFloor = Math.max(minZoom, 0.0001)
  const centerX = (piece.minX + piece.maxX) / 2
  const centerY = (piece.minY + piece.maxY) / 2
  const poiX = centerX + offsetX
  const poiY = centerY + offsetY
  const union: Bounds = {
    minX: Math.min(piece.minX, poiX),
    minY: Math.min(piece.minY, poiY),
    maxX: Math.max(piece.maxX, poiX),
    maxY: Math.max(piece.maxY, poiY),
  }
  const fitted = fitCamera(viewportW, viewportH, union, margin).zoom
  const shifted: Camera = {
    zoom: follow.zoom,
    x: follow.x - offsetX * follow.zoom,
    y: follow.y - offsetY * follow.zoom,
  }
  if (fitted < zoomFloor) {
    return shiftInside(
      follow,
      piece,
      offsetX,
      offsetY,
      viewportW,
      viewportH,
      zoomFloor,
      margin,
    )
  }
  const zoom = Math.max(zoomFloor, Math.min(follow.zoom, fitted))
  return clampCamera(shifted, union, zoom, viewportW, viewportH, margin)
}

function shiftInside(
  follow: Camera,
  piece: Bounds,
  offsetX: number,
  offsetY: number,
  viewportW: number,
  viewportH: number,
  zoomFloor: number,
  margin: number,
): Camera {
  const centerX = (piece.minX + piece.maxX) / 2
  const centerY = (piece.minY + piece.maxY) / 2
  const screenX = centerX * follow.zoom + follow.x
  const screenY = centerY * follow.zoom + follow.y
  const based = zoomCamera(
    follow,
    screenX,
    screenY,
    zoomFloor / Math.max(follow.zoom, 0.0001),
    zoomFloor,
    Math.max(zoomFloor, follow.zoom),
  )
  return clampCamera(
    {
      zoom: zoomFloor,
      x: based.x - offsetX * zoomFloor,
      y: based.y - offsetY * zoomFloor,
    },
    piece,
    zoomFloor,
    viewportW,
    viewportH,
    margin,
  )
}

function clampCamera(
  preferred: Camera,
  bounds: Bounds,
  zoom: number,
  viewportW: number,
  viewportH: number,
  margin: number,
): Camera {
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const screenX = centerX * preferred.zoom + preferred.x
  const screenY = centerY * preferred.zoom + preferred.y
  const rangeX = axisRange(bounds.minX, bounds.maxX, zoom, viewportW, margin)
  const rangeY = axisRange(bounds.minY, bounds.maxY, zoom, viewportH, margin)
  return {
    zoom,
    x: clamp(screenX - centerX * zoom, rangeX.min, rangeX.max),
    y: clamp(screenY - centerY * zoom, rangeY.min, rangeY.max),
  }
}

function axisRange(
  min: number,
  max: number,
  zoom: number,
  viewport: number,
  margin: number,
): { min: number; max: number } {
  const lower = margin - min * zoom
  const upper = viewport - margin - max * zoom
  if (lower <= upper) return { min: lower, max: upper }
  const mid = (lower + upper) / 2
  return { min: mid, max: mid }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
