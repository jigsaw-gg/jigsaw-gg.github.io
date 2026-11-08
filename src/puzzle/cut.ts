import { mixSeed, mulberry32 } from './random.ts'
import type { PuzzleSetup } from './session.ts'

export interface Point {
  x: number
  y: number
}

export interface PieceModel {
  col: number
  row: number
  points: Point[]
}

export interface PuzzleModel {
  cols: number
  rows: number
  cellW: number
  cellH: number
  pad: number
  pieces: PieceModel[]
}

export function chooseGrid(
  pieceCount: number,
  imageWidth: number,
  imageHeight: number,
): { cols: number; rows: number } {
  const count = Math.max(1, Math.floor(pieceCount))
  const target = imageWidth / imageHeight
  let bestCols = count
  let bestRows = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let rows = 1; rows <= count; rows += 1) {
    if (count % rows !== 0) continue
    const cols = count / rows
    const score = Math.abs(cols / rows - target)
    if (score < bestScore) {
      bestCols = cols
      bestRows = rows
      bestScore = score
    }
  }
  return { cols: bestCols, rows: bestRows }
}

export function buildPuzzle(setup: PuzzleSetup): PuzzleModel {
  const { cols, rows } = chooseGrid(
    setup.pieceCount,
    setup.imageWidth,
    setup.imageHeight,
  )
  const cellW = setup.imageWidth / cols
  const cellH = setup.imageHeight / rows
  const horizontal = new Map<string, Point[]>()
  const vertical = new Map<string, Point[]>()
  let maxDepth = 0

  for (let boundary = 1; boundary < rows; boundary += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cut = razorCut(rngFor(setup.seed, 1, col, boundary), cellW, cellH)
      maxDepth = Math.max(maxDepth, cut.depth)
      const y = boundary * cellH
      const x = col * cellW
      horizontal.set(
        edgeKey(col, boundary),
        placeCut(x, y, x + cellW, y, cut.points),
      )
    }
  }

  for (let boundary = 1; boundary < cols; boundary += 1) {
    for (let row = 0; row < rows; row += 1) {
      const cut = razorCut(rngFor(setup.seed, 2, boundary, row), cellH, cellW)
      maxDepth = Math.max(maxDepth, cut.depth)
      const x = boundary * cellW
      const y = row * cellH
      vertical.set(
        edgeKey(boundary, row),
        placeCut(x, y, x, y + cellH, cut.points),
      )
    }
  }

  const pieces: PieceModel[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * cellW
      const y = row * cellH
      const points: Point[] = []
      append(
        points,
        row === 0
          ? straight(x, y, x + cellW, y)
          : (horizontal.get(edgeKey(col, row)) ?? straight(x, y, x + cellW, y)),
        false,
      )
      append(
        points,
        col === cols - 1
          ? straight(x + cellW, y, x + cellW, y + cellH)
          : (vertical.get(edgeKey(col + 1, row)) ??
              straight(x + cellW, y, x + cellW, y + cellH)),
        false,
      )
      const bottomIsOuter = row === rows - 1
      append(
        points,
        bottomIsOuter
          ? straight(x + cellW, y + cellH, x, y + cellH)
          : (horizontal.get(edgeKey(col, row + 1)) ??
              straight(x, y + cellH, x + cellW, y + cellH)),
        // Stored cuts run left to right; the piece walks the bottom right to left.
        // The outer edge is already in that direction.
        !bottomIsOuter,
      )
      const leftIsOuter = col === 0
      append(
        points,
        leftIsOuter
          ? straight(x, y + cellH, x, y)
          : (vertical.get(edgeKey(col, row)) ?? straight(x, y, x, y + cellH)),
        // Stored cuts run top to bottom; the piece walks the left side upward.
        !leftIsOuter,
      )
      pieces.push({ col, row, points })
    }
  }

  return {
    cols,
    rows,
    cellW,
    cellH,
    pad: Math.ceil(maxDepth + 4),
    pieces,
  }
}

interface LocalPoint {
  along: number
  lat: number
}

interface RazorEdge {
  depth: number
  points: LocalPoint[]
}

interface TurnPhase {
  ds: number
  omega: number
}

function razorCut(rng: () => number, length: number, cross: number): RazorEdge {
  if (!(length > 0) || !(cross > 0)) return flatEdge(Math.max(0, length))
  const gentle = rng() < 0.5 ? rng() * 0.22 : 0.62 + rng() * 0.38
  const sign = rng() < 0.5 ? -1 : 1
  const tab = cutManeuver(rng, gentle)
  const spanNat = tab[tab.length - 1]?.along ?? 0
  let depthNat = 0
  for (const point of tab) depthNat = Math.max(depthNat, point.lat)
  if (!(spanNat > 1e-3) || !(depthNat > 1e-3)) return flatEdge(length)

  const spanWant = length * mix(0.15, 0.36, gentle) * (0.9 + rng() * 0.16)
  let scale = spanWant / spanNat
  const depthCap = cross * mix(0.17, 0.25, gentle) * (0.94 + rng() * 0.1)
  if (depthNat * scale > depthCap) scale = depthCap / depthNat
  const pad = length * 0.3
  const guard = length * 0.045
  let span = spanNat * scale
  const spanRoom = Math.max(length * 0.12, length - 2 * (pad + guard))
  if (span > spanRoom) {
    scale *= spanRoom / span
    span = spanRoom
  }
  const startMin = pad + guard
  const startMax = Math.max(startMin, length - pad - guard - span)
  const start = startMin + rng() * (startMax - startMin)

  const hand = handLine(rng, length, cross)
  const scaled = tab.map((point) => ({
    along: point.along * scale,
    lat: point.lat * scale,
  }))
  const placed = seatTab(
    scaled,
    start,
    span,
    latOn(hand, start),
    latOn(hand, Math.min(length, start + span)),
    sign,
  )
  fitAlong(placed, length, pad)
  const open = placed[0]?.along ?? start
  const close = placed[placed.length - 1]?.along ?? start + span
  const points: LocalPoint[] = []
  for (const point of hand) if (point.along < open) points.push(point)
  points.push(...placed)
  for (const point of hand) if (point.along > close) points.push(point)
  let depth = 0
  for (const point of points) depth = Math.max(depth, Math.abs(point.lat))
  return { depth, points }
}

// Dip to +lat while traveling forward. Heading is measured from forward,
// positive toward the dip. The opposite side mirrors the whole path.
// 1. slow turn toward the dip
// 2. swift hook further in, carving the near lobe of the neck
// 3. long turn the other way around the round dip
// 4. swift hook out of the far lobe, then ease back onto the line
function cutManeuver(rng: () => number, gentle: number): LocalPoint[] {
  const vary = (spread: number) => 1 + (rng() - 0.5) * spread
  const beta = mix(2.45, 2.05, gentle) * vary(0.08)
  const shoulder = Math.min(beta * 0.45, mix(0.3, 0.58, gentle) * vary(0.14))
  const rBowl = mix(0.32, 1.5, gentle) * vary(0.2)
  const rHook = mix(0.09, 0.48, gentle) * vary(0.22)
  const rSlow = mix(0.46, 1.7, gentle) * vary(0.2)
  const bowlSide = 0.86 + rng() * 0.3
  const hookSide = 0.86 + rng() * 0.3
  const rise = Math.max(0.05, beta - shoulder)
  const phases: TurnPhase[] = [
    { ds: rSlow * shoulder, omega: 1 / rSlow },
    { ds: rHook * rise, omega: 1 / rHook },
    { ds: rBowl * beta, omega: -1 / rBowl },
    { ds: rBowl * bowlSide * beta, omega: -1 / (rBowl * bowlSide) },
    { ds: rHook * hookSide * rise, omega: 1 / (rHook * hookSide) },
    { ds: rSlow * shoulder, omega: 1 / rSlow },
  ]
  const step = Math.min(rHook, rBowl, rSlow) / 7
  const points: LocalPoint[] = [{ along: 0, lat: 0 }]
  let along = 0
  let lat = 0
  let theta = 0
  for (const phase of phases) {
    const steps = Math.max(4, Math.round(phase.ds / step))
    const ds = phase.ds / steps
    for (let index = 0; index < steps; index += 1) {
      theta += phase.omega * ds
      along += Math.cos(theta) * ds
      lat += Math.sin(theta) * ds
      points.push({ along, lat })
    }
  }
  pinEnds(points)
  rotateAboutCenter(points, (rng() - 0.5) * mix(0.1, 0.06, gentle))
  pinEnds(points)
  const count = points.length - 1
  const span = points[count]?.along || 1
  const tip = points.reduce((max, point) => Math.max(max, point.lat), 0) || 1
  const amp = tip * (0.03 + rng() * 0.04)
  const freq = 1.3 + rng() * 2.4
  const phase = rng() * Math.PI * 2
  const alongAmp = span * (0.012 + rng() * 0.02)
  for (let index = 0; index <= count; index += 1) {
    const u = index / count
    const env = Math.sin(Math.PI * u)
    points[index].lat += Math.sin(freq * Math.PI * u + phase) * amp * env
    points[index].along +=
      Math.sin(freq * Math.PI * u + phase + 1.7) * alongAmp * env
  }
  pinEnds(points)
  return points
}

function handLine(
  rng: () => number,
  length: number,
  cross: number,
): LocalPoint[] {
  const steps = 96
  const waves = [0, 1, 2, 3].map((index) => ({
    freq: (index + 1) * (0.7 + rng() * 0.8),
    phase: rng() * Math.PI * 2,
    mag: (0.18 + rng() * 0.2) / (index + 1),
  }))
  const points: LocalPoint[] = [{ along: 0, lat: 0 }]
  let along = 0
  let lat = 0
  let theta = 0
  const ds = length / steps
  for (let index = 1; index <= steps; index += 1) {
    const u = index / steps
    let aim = 0
    for (const wave of waves) {
      aim += Math.sin(wave.freq * Math.PI * u + wave.phase) * wave.mag
    }
    theta += (aim - (lat / length) * 1.5 - theta) * 0.42
    theta = Math.max(-0.55, Math.min(0.55, theta))
    along += Math.cos(theta) * ds
    lat += Math.sin(theta) * ds
    points.push({ along, lat })
  }
  const count = points.length - 1
  const endAlong = points[count].along || length
  const endLat = points[count].lat
  for (let index = 0; index <= count; index += 1) {
    const u = index / count
    points[index].along = (points[index].along / endAlong) * length
    points[index].lat -= endLat * u
  }
  points[0] = { along: 0, lat: 0 }
  points[count] = { along: length, lat: 0 }
  const cap = Math.min(length, cross) * 0.07
  let peak = 0
  for (const point of points) peak = Math.max(peak, Math.abs(point.lat))
  if (peak > cap) {
    const scale = cap / peak
    for (const point of points) point.lat *= scale
  }
  return points
}

function fitAlong(points: LocalPoint[], length: number, pad: number): void {
  let min = Infinity
  let max = -Infinity
  for (const point of points) {
    min = Math.min(min, point.along)
    max = Math.max(max, point.along)
  }
  const lo = pad
  const hi = length - pad
  const span = Math.max(1e-6, max - min)
  const room = Math.max(1e-6, hi - lo)
  const scale = Math.min(1, room / span)
  const mid = (min + max) / 2
  const half = (span * scale) / 2
  let center = mid
  if (center - half < lo) center = lo + half
  if (center + half > hi) center = hi - half
  for (const point of points) {
    point.along = center + (point.along - mid) * scale
  }
}

function seatTab(
  tab: LocalPoint[],
  start: number,
  span: number,
  b0: number,
  b1: number,
  sign: number,
): LocalPoint[] {
  const chord = Math.hypot(span, b1 - b0) || 1
  const fx = span / chord
  const fy = (b1 - b0) / chord
  const nx = -fy
  const ny = fx
  return tab.map((point) => {
    const dist = span === 0 ? 0 : (point.along / span) * chord
    const side = point.lat * sign
    return {
      along: start + fx * dist + nx * side,
      lat: b0 + fy * dist + ny * side,
    }
  })
}

function latOn(path: LocalPoint[], along: number): number {
  if (path.length === 0 || along <= 0) return 0
  const last = path[path.length - 1]
  if (!last || along >= last.along) return 0
  let lo = 0
  let hi = path.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (path[mid].along < along) lo = mid
    else hi = mid
  }
  const left = path[lo]
  const right = path[hi]
  const span = right.along - left.along
  const fraction = span === 0 ? 0 : (along - left.along) / span
  return left.lat + (right.lat - left.lat) * fraction
}

function pinEnds(points: LocalPoint[]): void {
  const count = points.length - 1
  if (count < 1) return
  const startAlong = points[0].along
  const startLat = points[0].lat
  const endLat = points[count].lat
  for (let index = 0; index <= count; index += 1) {
    const u = index / count
    points[index].along -= startAlong
    points[index].lat -= startLat * (1 - u) + endLat * u
  }
}

function rotateAboutCenter(points: LocalPoint[], angle: number): void {
  const count = points.length - 1
  if (count < 1 || angle === 0) return
  const origin = points[count].along / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (const point of points) {
    const x = point.along - origin
    const y = point.lat
    point.along = origin + x * cos - y * sin
    point.lat = x * sin + y * cos
  }
}

function flatEdge(length: number): RazorEdge {
  return {
    depth: 0,
    points: [
      { along: 0, lat: 0 },
      { along: length, lat: 0 },
    ],
  }
}

function mix(thin: number, wide: number, gentle: number): number {
  return thin + (wide - thin) * gentle
}

function placeCut(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  points: LocalPoint[],
): Point[] {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const fx = dx / len
  const fy = dy / len
  const nx = -fy
  const ny = fx
  return points.map((point) => ({
    x: x0 + fx * point.along + nx * point.lat,
    y: y0 + fy * point.along + ny * point.lat,
  }))
}

function straight(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ]
}

function append(points: Point[], edge: Point[], reverse: boolean): void {
  const sequence = reverse ? [...edge].reverse() : edge
  const start = points.length === 0 ? 0 : 1
  for (let index = start; index < sequence.length; index += 1) {
    points.push(sequence[index])
  }
}

function edgeKey(a: number, b: number): string {
  return `${a}:${b}`
}

function rngFor(
  seed: number,
  kind: number,
  a: number,
  b: number,
): () => number {
  const salt = kind * 1_000_003 + a * 1_009 + b
  return mulberry32(mixSeed(seed >>> 0, salt))
}
