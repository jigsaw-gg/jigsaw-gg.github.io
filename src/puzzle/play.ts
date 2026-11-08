import type { PuzzleModel } from './cut.ts'
import { mixSeed, mulberry32 } from './random.ts'

const SLOT_GAP = 0.28 * 2
const SLOT_JITTER = 0.08
const SCATTER_SALT = 81_001
const HIGHLIGHT_FRACTION = 0.1
const SNAP_FRACTION = 0.05
const HIGHLIGHT_MIN_PX = 5
const ALIGNED = 0.5

const SIDES = [
  { dc: 1, dr: 0 },
  { dc: -1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: 0, dr: -1 },
] as const

export interface Placement {
  id: string
  col: number
  row: number
  x: number
  y: number
  group: string
}

export interface ScatteredBoard {
  playW: number
  playH: number
  cellW: number
  cellH: number
  pad: number
  placements: Placement[]
}

export interface NearPair {
  pieceId: string
  neighborId: string
}

export function pieceId(col: number, row: number): string {
  return `${col}:${row}`
}

export function scatterPieces(
  model: PuzzleModel,
  seed: number,
): ScatteredBoard {
  const { cols, rows, cellW, cellH, pad, pieces } = model
  const gapX = cellW * SLOT_GAP
  const gapY = cellH * SLOT_GAP
  const slotW = cellW + gapX
  const slotH = cellH + gapY
  const marginX = pad + cellW * (SLOT_JITTER / 2)
  const marginY = pad + cellH * (SLOT_JITTER / 2)
  const playW = marginX * 2 + cols * cellW + Math.max(0, cols - 1) * gapX
  const playH = marginY * 2 + rows * cellH + Math.max(0, rows - 1) * gapY
  const rng = mulberry32(mixSeed(seed >>> 0, SCATTER_SALT))
  const order = pieces.map((piece) => pieceId(piece.col, piece.row))
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const current = order[index]
    order[index] = order[swap] ?? current
    order[swap] = current
  }
  if (
    order.length > 1 &&
    order.every(
      (id, index) => id === pieceId(index % cols, Math.floor(index / cols)),
    )
  ) {
    const first = order[0]
    order[0] = order[1] ?? first
    order[1] = first
  }
  const slotOf = new Map(order.map((id, index) => [id, index]))
  const placements = pieces.map((piece) => {
    const id = pieceId(piece.col, piece.row)
    const slot = slotOf.get(id) ?? 0
    const slotCol = slot % cols
    const slotRow = Math.floor(slot / cols)
    const jitterX = (rng() - 0.5) * cellW * SLOT_JITTER
    const jitterY = (rng() - 0.5) * cellH * SLOT_JITTER
    return {
      id,
      col: piece.col,
      row: piece.row,
      x: marginX + slotCol * slotW + jitterX,
      y: marginY + slotRow * slotH + jitterY,
      group: id,
    }
  })
  return { playW, playH, cellW, cellH, pad, placements }
}

export function approachLimits(
  pieceSize: number,
  scale: number,
): { highlight: number; snap: number } {
  const safe = scale > 0 && Number.isFinite(scale) ? scale : 1
  return {
    highlight: Math.max(
      pieceSize * HIGHLIGHT_FRACTION,
      HIGHLIGHT_MIN_PX / safe,
    ),
    snap: pieceSize * SNAP_FRACTION,
  }
}

/** Minimum table size relative to the scattered piece field, on each axis. */
const TABLE_MIN_SPAN = 2
const TABLE_RATIO = 16 / 9

export function playArea(playW: number, playH: number): Bounds {
  const neededW = Math.max(1, playW) * TABLE_MIN_SPAN
  const neededH = Math.max(1, playH) * TABLE_MIN_SPAN
  const width =
    neededW / neededH > TABLE_RATIO ? neededW : neededH * TABLE_RATIO
  const height = width / TABLE_RATIO
  const minX = (playW - width) / 2
  const minY = (playH - height) / 2
  return { minX, minY, maxX: minX + width, maxY: minY + height }
}

export function clampGroup(
  placements: Placement[],
  group: string,
  anchorId: string,
  x: number,
  y: number,
  cellW: number,
  cellH: number,
  pad: number,
  area: Bounds,
): { x: number; y: number } {
  const anchor = placements.find((piece) => piece.id === anchorId)
  if (!anchor || anchor.group !== group) return { x, y }
  let minDx = Number.NEGATIVE_INFINITY
  let maxDx = Number.POSITIVE_INFINITY
  let minDy = Number.NEGATIVE_INFINITY
  let maxDy = Number.POSITIVE_INFINITY
  for (const piece of placements) {
    if (piece.group !== group) continue
    minDx = Math.max(minDx, area.minX + pad - piece.x)
    maxDx = Math.min(maxDx, area.maxX - pad - cellW - piece.x)
    minDy = Math.max(minDy, area.minY + pad - piece.y)
    maxDy = Math.min(maxDy, area.maxY - pad - cellH - piece.y)
  }
  const dx = x - anchor.x
  const dy = y - anchor.y
  return {
    x: anchor.x + (minDx > maxDx ? 0 : Math.min(maxDx, Math.max(minDx, dx))),
    y: anchor.y + (minDy > maxDy ? 0 : Math.min(maxDy, Math.max(minDy, dy))),
  }
}

export function moveGroup(
  placements: Placement[],
  group: string,
  anchorId: string,
  x: number,
  y: number,
): Placement[] {
  const anchor = placements.find((piece) => piece.id === anchorId)
  if (!anchor || anchor.group !== group) return placements
  const dx = x - anchor.x
  const dy = y - anchor.y
  if (dx === 0 && dy === 0) return placements
  return placements.map((piece) =>
    piece.group === group
      ? { ...piece, x: piece.x + dx, y: piece.y + dy }
      : piece,
  )
}

interface Approach {
  pieceId: string
  neighborId: string
  neighborGroup: string
  distance: number
  dx: number
  dy: number
}

function approaches(
  placements: Placement[],
  group: string,
  cellW: number,
  cellH: number,
): Approach[] {
  const byId = new Map(placements.map((piece) => [piece.id, piece]))
  const found: Approach[] = []
  for (const piece of placements) {
    if (piece.group !== group) continue
    for (const side of SIDES) {
      const neighbor = byId.get(
        pieceId(piece.col + side.dc, piece.row + side.dr),
      )
      if (!neighbor || neighbor.group === group) continue
      const dx = neighbor.x - side.dc * cellW - piece.x
      const dy = neighbor.y - side.dr * cellH - piece.y
      found.push({
        pieceId: piece.id,
        neighborId: neighbor.id,
        neighborGroup: neighbor.group,
        distance: Math.hypot(dx, dy),
        dx,
        dy,
      })
    }
  }
  found.sort((left, right) => left.distance - right.distance)
  return found
}

const FIT_MARGIN = 64

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Camera {
  zoom: number
  x: number
  y: number
}

export function pieceBounds(
  placements: Placement[],
  cellW: number,
  cellH: number,
  pad: number,
): Bounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const piece of placements) {
    minX = Math.min(minX, piece.x - pad)
    minY = Math.min(minY, piece.y - pad)
    maxX = Math.max(maxX, piece.x + cellW + pad)
    maxY = Math.max(maxY, piece.y + cellH + pad)
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  }
  return { minX, minY, maxX, maxY }
}

export function fitCamera(
  viewportW: number,
  viewportH: number,
  bounds: Bounds,
  margin = FIT_MARGIN,
): Camera {
  const contentW = Math.max(1, bounds.maxX - bounds.minX)
  const contentH = Math.max(1, bounds.maxY - bounds.minY)
  const availW = Math.max(1, viewportW - margin * 2)
  const availH = Math.max(1, viewportH - margin * 2)
  const zoom = Math.min(availW / contentW, availH / contentH)
  return {
    zoom,
    x: (viewportW - contentW * zoom) / 2 - bounds.minX * zoom,
    y: (viewportH - contentH * zoom) / 2 - bounds.minY * zoom,
  }
}

export function cameraLimits(
  viewportW: number,
  viewportH: number,
  bounds: Bounds,
  pieceSize: number,
): { min: number; max: number } {
  const fit = Math.max(fitCamera(viewportW, viewportH, bounds).zoom, 0.0001)
  const close = (Math.min(viewportW, viewportH) * 0.72) / Math.max(pieceSize, 1)
  return { min: fit * 0.4, max: Math.max(fit * 1.05, close) }
}

export function zoomCamera(
  camera: Camera,
  cursorX: number,
  cursorY: number,
  factor: number,
  minZoom: number,
  maxZoom: number,
): Camera {
  const zoom = Math.min(maxZoom, Math.max(minZoom, camera.zoom * factor))
  const worldX = (cursorX - camera.x) / camera.zoom
  const worldY = (cursorY - camera.y) / camera.zoom
  return {
    zoom,
    x: cursorX - worldX * zoom,
    y: cursorY - worldY * zoom,
  }
}

export function pullToNeighbors(
  placements: Placement[],
  group: string,
  cellW: number,
  cellH: number,
  highlight: number,
  snap: number,
): { placements: Placement[]; near: NearPair | null; snapped: boolean } {
  let current = placements
  let snapped = false
  let moved = false
  for (let guard = 0; guard < current.length; guard += 1) {
    const pending = approaches(current, group, cellW, cellH)
    const best = pending.find(
      (item) => item.distance < snap && (!moved || item.distance < ALIGNED),
    )
    if (!best) {
      const closest = pending[0]
      return {
        placements: current,
        near:
          closest && closest.distance < highlight
            ? { pieceId: closest.pieceId, neighborId: closest.neighborId }
            : null,
        snapped,
      }
    }
    if (!moved) {
      current = current.map((piece) =>
        piece.group === group
          ? { ...piece, x: piece.x + best.dx, y: piece.y + best.dy }
          : piece,
      )
      moved = true
    }
    current = current.map((piece) =>
      piece.group === best.neighborGroup ? { ...piece, group } : piece,
    )
    snapped = true
  }
  return { placements: current, near: null, snapped }
}
