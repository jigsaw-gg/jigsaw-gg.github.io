import type { PuzzleModel } from './cut.ts'
import { mixSeed, mulberry32 } from './random.ts'

const SLOT_GAP = 0.28 * 2
const SLOT_JITTER = 0.08
const RESERVE_RATIO = 16 / 9
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
  /** Image-sized 16:9 clearing left empty in the center. */
  reserve: Bounds
}

export interface NearPair {
  group: string
  neighborGroup: string
}

export function pieceId(col: number, row: number): string {
  return `${col}:${row}`
}

interface Slot {
  x: number
  y: number
}

/**
 * Columns and rows of the one-piece frame around the centered reserve.
 * Corners belong to the top and bottom rows. The pitch stays at least the
 * scatter gap, and any leftover span is shared so the corners keep that gap
 * from the reserve.
 */
function innerFrame(
  reserveW: number,
  reserveH: number,
  cellW: number,
  cellH: number,
  gapX: number,
  gapY: number,
): { xs: number[]; ys: number[] } {
  const slotW = cellW + gapX
  const slotH = cellH + gapY
  const insetX = reserveW / 2 + gapX
  const insetY = reserveH / 2 + gapY
  const leftX = -insetX - cellW
  const rightX = insetX
  const topY = -insetY - cellH
  const bottomY = insetY
  const spanW = rightX + cellW - leftX
  const countX = Math.max(2, Math.floor((spanW + gapX) / slotW))
  const extraX = Math.max(0, spanW - (countX * cellW + (countX - 1) * gapX))
  const pitchX = cellW + gapX + extraX / (countX - 1)
  const xs: number[] = []
  for (let index = 0; index < countX; index += 1) {
    xs.push(leftX + index * pitchX)
  }

  const sideTop = topY + cellH + gapY
  const sideSpan = bottomY - gapY - sideTop
  const countY = Math.floor((sideSpan + gapY) / slotH)
  const ys = [topY]
  if (countY > 0) {
    const extraY = Math.max(
      0,
      sideSpan - (countY * cellH + (countY - 1) * gapY),
    )
    const pitchY = countY === 1 ? 0 : cellH + gapY + extraY / (countY - 1)
    const offsetY = countY === 1 ? extraY / 2 : 0
    for (let index = 0; index < countY; index += 1) {
      ys.push(sideTop + offsetY + index * pitchY)
    }
  }
  ys.push(bottomY)
  return { xs, ys }
}

/** Center, then the cell left of it, then the cell right of it, and outward. */
function centerOut(values: number[]): number[] {
  const mid = (values.length - 1) / 2
  return values
    .map((value, index) => ({ value, index, dist: Math.abs(index - mid) }))
    .sort((a, b) => a.dist - b.dist || a.index - b.index)
    .map((entry) => entry.value)
}

function place(slots: Slot[], count: number, x: number, y: number): boolean {
  if (slots.length >= count) return false
  slots.push({ x, y })
  return true
}

/**
 * Seats for pieces taken in shuffle order.
 * The first seats trace the one-piece frame around the reserve. After that
 * frame is full, pieces grow it: the new left and right columns from top to
 * bottom, then the row above from the center outward, then the row below.
 */
function slotsAroundReserve(
  count: number,
  reserveW: number,
  reserveH: number,
  cellW: number,
  cellH: number,
  gapX: number,
  gapY: number,
): Slot[] {
  if (count <= 0) return []
  const frame = innerFrame(reserveW, reserveH, cellW, cellH, gapX, gapY)
  const topY = frame.ys[0]
  const bottomY = frame.ys[frame.ys.length - 1]
  const leftX = frame.xs[0]
  const rightX = frame.xs[frame.xs.length - 1]
  if (
    topY === undefined ||
    bottomY === undefined ||
    leftX === undefined ||
    rightX === undefined
  ) {
    return []
  }
  const slots: Slot[] = []
  for (const x of frame.xs) {
    if (!place(slots, count, x, topY)) return slots
  }
  for (let index = 1; index < frame.ys.length - 1; index += 1) {
    const y = frame.ys[index]
    if (y === undefined || !place(slots, count, rightX, y)) return slots
  }
  for (let index = frame.xs.length - 1; index >= 0; index -= 1) {
    const x = frame.xs[index]
    if (x === undefined || !place(slots, count, x, bottomY)) return slots
  }
  for (let index = frame.ys.length - 2; index >= 1; index -= 1) {
    const y = frame.ys[index]
    if (y === undefined || !place(slots, count, leftX, y)) return slots
  }

  let xs = frame.xs
  let ys = frame.ys
  for (let guard = 0; slots.length < count; guard += 1) {
    if (guard > count) {
      throw new Error('could not place every piece around the center')
    }
    const outerLeft = (xs[0] ?? 0) - (cellW + gapX)
    const outerRight = (xs[xs.length - 1] ?? 0) + (cellW + gapX)
    for (const y of ys) {
      if (!place(slots, count, outerLeft, y)) return slots
      if (!place(slots, count, outerRight, y)) return slots
    }
    xs = [outerLeft, ...xs, outerRight]
    const aboveY = (ys[0] ?? 0) - (cellH + gapY)
    for (const x of centerOut(xs)) {
      if (!place(slots, count, x, aboveY)) return slots
    }
    ys = [aboveY, ...ys]
    const belowY = (ys[ys.length - 1] ?? 0) + (cellH + gapY)
    for (const x of centerOut(xs)) {
      if (!place(slots, count, x, belowY)) return slots
    }
    ys = [...ys, belowY]
  }
  return slots
}

export function scatterPieces(
  model: PuzzleModel,
  seed: number,
): ScatteredBoard {
  const { cols, rows, cellW, cellH, pad, pieces } = model
  const gapX = cellW * SLOT_GAP
  const gapY = cellH * SLOT_GAP
  const marginX = pad + cellW * (SLOT_JITTER / 2)
  const marginY = pad + cellH * (SLOT_JITTER / 2)
  // Same area as the source image, left empty as a 16:9 center.
  const imageArea = Math.max(1, cols * cellW * rows * cellH)
  const reserveW = Math.sqrt(imageArea * RESERVE_RATIO)
  const reserveH = reserveW / RESERVE_RATIO
  const rng = mulberry32(mixSeed(seed >>> 0, SCATTER_SALT))
  const around = slotsAroundReserve(
    pieces.length,
    reserveW,
    reserveH,
    cellW,
    cellH,
    gapX,
    gapY,
  )
  let minX = -reserveW / 2
  let minY = -reserveH / 2
  let maxX = reserveW / 2
  let maxY = reserveH / 2
  for (const slot of around) {
    minX = Math.min(minX, slot.x)
    minY = Math.min(minY, slot.y)
    maxX = Math.max(maxX, slot.x + cellW)
    maxY = Math.max(maxY, slot.y + cellH)
  }
  const shiftX = marginX - minX
  const shiftY = marginY - minY
  const playW = maxX - minX + marginX * 2
  const playH = maxY - minY + marginY * 2
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
    const slot = around[slotOf.get(id) ?? 0]
    const jitterX = (rng() - 0.5) * cellW * SLOT_JITTER
    const jitterY = (rng() - 0.5) * cellH * SLOT_JITTER
    return {
      id,
      col: piece.col,
      row: piece.row,
      x: (slot?.x ?? 0) + shiftX + jitterX,
      y: (slot?.y ?? 0) + shiftY + jitterY,
      group: id,
    }
  })
  return {
    playW,
    playH,
    cellW,
    cellH,
    pad,
    placements,
    reserve: {
      minX: -reserveW / 2 + shiftX,
      minY: -reserveH / 2 + shiftY,
      maxX: reserveW / 2 + shiftX,
      maxY: reserveH / 2 + shiftY,
    },
  }
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

/** True when every piece shares one group (the assembled puzzle). */
export function isPuzzleComplete(placements: readonly Placement[]): boolean {
  if (placements.length === 0) return false
  const group = placements[0]?.group
  if (group === undefined) return false
  return placements.every((piece) => piece.group === group)
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
            ? { group, neighborGroup: closest.neighborGroup }
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
