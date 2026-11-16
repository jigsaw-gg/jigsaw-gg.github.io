import type { PieceModel, Point } from '../jigsaw/cut.ts'
import { clearCanvas, layoutCanvas } from './canvas.ts'

export function drawPiece(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  piece: PieceModel,
  cellW: number,
  cellH: number,
  pad: number,
): void {
  const width = cellW + pad * 2
  const height = cellH + pad * 2
  const ctx = layoutCanvas(canvas, width, height)
  if (!ctx) return
  clearCanvas(ctx, width, height)
  const originX = piece.col * cellW - pad
  const originY = piece.row * cellH - pad
  trace(ctx, piece.points, originX, originY)
  ctx.save()
  ctx.clip()
  ctx.drawImage(image, -originX, -originY)
  paintBevel(ctx, piece.points, originX, originY)
  ctx.restore()
}

// Light sits at 10:30 on the clock, so edges facing up-left catch it.
const BEVEL_PX = 3
const LIGHT_HOURS = 10.5
const BEVEL_BANDS = [
  { reach: BEVEL_PX, alpha: 0.28 },
  { reach: BEVEL_PX * 0.72, alpha: 0.32 },
  { reach: BEVEL_PX * 0.45, alpha: 0.38 },
  { reach: BEVEL_PX * 0.22, alpha: 0.46 },
  { reach: BEVEL_PX * 0.08, alpha: 0.55 },
]

interface PlanePoint {
  x: number
  y: number
}

interface BevelRun {
  facing: number
  points: PlanePoint[]
}

function paintBevel(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  originX: number,
  originY: number,
): void {
  const ring = pieceRing(points, originX, originY)
  if (ring.length < 3) return
  const light = clockVector(LIGHT_HOURS)
  const facing = edgeFacing(ring, light)
  const runs = bevelRuns(ring, facing)
  const corners = bevelCorners(ring, facing)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'
  for (const band of BEVEL_BANDS) {
    ctx.lineWidth = band.reach * 2
    for (const run of runs) {
      ctx.strokeStyle = bevelStyle(run.facing, band.alpha)
      ctx.beginPath()
      const first = run.points[0]
      if (!first) continue
      ctx.moveTo(first.x, first.y)
      for (let index = 1; index < run.points.length; index += 1) {
        const point = run.points[index]
        if (point) ctx.lineTo(point.x, point.y)
      }
      ctx.stroke()
    }
    for (const corner of corners) {
      ctx.fillStyle = bevelStyle(corner.facing, band.alpha)
      ctx.beginPath()
      ctx.arc(corner.x, corner.y, band.reach, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function pieceRing(
  points: Point[],
  originX: number,
  originY: number,
): PlanePoint[] {
  const ring: PlanePoint[] = []
  for (const point of points) {
    const next = { x: point.x - originX, y: point.y - originY }
    const prev = ring[ring.length - 1]
    if (prev && Math.hypot(prev.x - next.x, prev.y - next.y) < 0.05) continue
    ring.push(next)
  }
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (
    first &&
    last &&
    ring.length > 1 &&
    Math.hypot(first.x - last.x, first.y - last.y) < 0.05
  ) {
    ring.pop()
  }
  return ring
}

function clockVector(hours: number): PlanePoint {
  const angle = (hours / 12) * Math.PI * 2
  return { x: Math.sin(angle), y: -Math.cos(angle) }
}

function edgeFacing(ring: PlanePoint[], light: PlanePoint): number[] {
  const count = ring.length
  const normals: PlanePoint[] = []
  for (let index = 0; index < count; index += 1) {
    const from = ring[index]
    const to = ring[(index + 1) % count]
    if (!from || !to) {
      normals.push({ x: 0, y: 0 })
      continue
    }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    normals.push({ x: dy / length, y: -dx / length })
  }
  return normals.map((normal, index) => {
    const prev = normals[(index + count - 1) % count] ?? normal
    const next = normals[(index + 1) % count] ?? normal
    let x = prev.x + normal.x + next.x
    let y = prev.y + normal.y + next.y
    const length = Math.hypot(x, y) || 1
    x /= length
    y /= length
    return x * light.x + y * light.y
  })
}

function bevelRuns(ring: PlanePoint[], facing: number[]): BevelRun[] {
  const count = ring.length
  const bucket = (value: number) => Math.round(value * 16)
  let origin = 0
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    if (bucket(facing[index] ?? 0) !== bucket(facing[next] ?? 0)) {
      origin = next
      break
    }
  }
  const runs: BevelRun[] = []
  let runStart = 0
  let runBucket = bucket(facing[origin] ?? 0)
  let facingSum = facing[origin] ?? 0
  for (let step = 1; step <= count; step += 1) {
    const edge = (origin + step) % count
    const done = step === count
    const edgeBucket = bucket(facing[edge] ?? 0)
    if (!done && edgeBucket === runBucket) {
      facingSum += facing[edge] ?? 0
      continue
    }
    const points: PlanePoint[] = []
    for (let cursor = runStart; cursor <= step; cursor += 1) {
      const point = ring[(origin + cursor) % count]
      if (point) points.push(point)
    }
    const edges = step - runStart
    runs.push({ facing: facingSum / edges, points })
    runStart = step
    runBucket = edgeBucket
    facingSum = facing[edge] ?? 0
  }
  return runs
}

function bevelCorners(
  ring: PlanePoint[],
  facing: number[],
): Array<PlanePoint & { facing: number }> {
  const count = ring.length
  const corners: Array<PlanePoint & { facing: number }> = []
  for (let index = 0; index < count; index += 1) {
    const prev = ring[(index + count - 1) % count]
    const point = ring[index]
    const next = ring[(index + 1) % count]
    if (!prev || !point || !next) continue
    if (turnAngle(prev, point, next) < 0.55) continue
    const before = facing[(index + count - 1) % count] ?? 0
    const after = facing[index] ?? 0
    corners.push({ x: point.x, y: point.y, facing: (before + after) / 2 })
  }
  return corners
}

function turnAngle(from: PlanePoint, at: PlanePoint, to: PlanePoint): number {
  const abx = at.x - from.x
  const aby = at.y - from.y
  const bcx = to.x - at.x
  const bcy = to.y - at.y
  const left = Math.hypot(abx, aby) || 1
  const right = Math.hypot(bcx, bcy) || 1
  const dot = (abx / left) * (bcx / right) + (aby / left) * (bcy / right)
  return Math.acos(Math.min(1, Math.max(-1, dot)))
}

function bevelStyle(facing: number, alpha: number): string {
  const lit = Math.min(1, Math.max(0, (facing + 1) / 2))
  const blend = lit * lit * (3 - 2 * lit)
  const r = Math.round(6 + (214 - 6) * blend)
  const g = Math.round(18 + (230 - 18) * blend)
  const b = Math.round(44 + (248 - 44) * blend)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function trace(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  originX: number,
  originY: number,
): void {
  const first = points[0]
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first.x - originX, first.y - originY)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    ctx.lineTo(point.x - originX, point.y - originY)
  }
  ctx.closePath()
}
