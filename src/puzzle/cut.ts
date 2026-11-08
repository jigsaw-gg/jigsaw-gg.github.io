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

// Share of the shorter cell side given to every dip outline. Chosen so a
// round dip is about 1.7× the previous median knob, in both width and depth.
const DIP_BORDER = 0.954
const DIP_STEPS = 210

function razorCut(rng: () => number, length: number, cross: number): RazorEdge {
  if (!(length > 0) || !(cross > 0)) return flatEdge(Math.max(0, length))
  const sign = rng() < 0.5 ? -1 : 1
  const reach = Math.min(length, cross)
  const border = reach * DIP_BORDER
  const tab = traceDip(sampleDip(rng))
  rotateAboutCenter(tab, (rng() - 0.5) * 0.08)
  pinEnds(tab)
  scaleToArc(tab, border)
  const origin = tab[0]?.along ?? 0
  const tip = tab[tab.length - 1]?.along ?? border
  for (const point of tab) point.along -= origin
  const span = tip - origin
  if (!(span > 1e-3)) return flatEdge(length)

  let minAlong = Infinity
  let maxAlong = -Infinity
  for (const point of tab) {
    minAlong = Math.min(minAlong, point.along)
    maxAlong = Math.max(maxAlong, point.along)
  }
  const box = Math.max(1e-6, maxAlong - minAlong)
  const inset = Math.min(reach * 0.18, Math.max(0, (length - box) / 2))
  const slack = Math.max(0, length - box - 2 * inset)
  const play = slack * 0.4
  const start = inset - minAlong + (slack - play) / 2 + rng() * play
  const hand = handLine(rng, length, cross)
  const placed = seatTab(
    tab,
    start,
    span,
    latOn(hand, clamp(start, 0, length)),
    latOn(hand, clamp(start + span, 0, length)),
    sign,
  )
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

interface DipShape {
  alphaIn: number
  alphaOut: number
  entryFrac: number
  exitFrac: number
  entryPower: number
  exitPower: number
  bowlShape: number
  bowlBias: number
  sharp: number
  floor: number
  ripple: number
  rippleFreq: number
  ripplePhase: number
}

// One border length, bent different ways. Curvature is positive while the
// razor turns toward the dip (slowly, then more tightly), negative for the
// single sweep around the bowl, then positive again on the way out. The
// second derivative — how that turn tightens and eases — is what changes
// a round knob into a pear or a thin deep one.
function sampleDip(rng: () => number): DipShape {
  const roll = rng()
  let stretch: number
  let neck: number
  let bias: number
  let skew: number
  if (roll < 0.3) {
    stretch = rng() * 0.08
    neck = rng()
    bias = (rng() - 0.5) * 0.2
    skew = (rng() - 0.5) * 0.3
  } else if (roll < 0.55) {
    stretch = 0.84 + rng() * 0.16
    neck = 0
    bias = (rng() - 0.5) * 0.22
    skew = (rng() - 0.5) * 0.28
  } else if (roll < 0.76) {
    stretch = 0.36 + rng() * 0.24
    neck = rng() * 0.2
    bias = (rng() - 0.5) * 0.4
    skew = (rng() - 0.5) * 0.5
  } else {
    stretch = 0.58 + rng() * 0.22
    neck = 0
    bias = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.35)
    skew = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.35)
  }
  const ease = stretch * stretch * (3 - 2 * stretch)
  const alpha = lerp(2.42, 1.48, ease)
  const skewScale = 1 + skew * 0.14
  const roundBowl = -0.72 * neck
  return {
    alphaIn: alpha * skewScale,
    alphaOut: alpha / skewScale,
    entryFrac: clamp(lerp(0.105, 0.055, ease) * (1 - skew * 0.08), 0.048, 0.16),
    exitFrac: clamp(lerp(0.105, 0.055, ease) * (1 + skew * 0.08), 0.048, 0.16),
    entryPower: lerp(1.2, 1.55, ease),
    exitPower: lerp(1.2, 1.55, ease),
    bowlShape: lerp(roundBowl, 0.992, ease),
    bowlBias: bias,
    sharp: lerp(0.18, 0.058, ease),
    floor: lerp(neck > 0.3 ? 0.06 : 0.32, 0.001, ease),
    ripple: rng() * 0.35,
    rippleFreq: rng() < 0.65 ? 1 : 2,
    ripplePhase: rng() * Math.PI * 2,
  }
}

function traceDip(shape: DipShape): LocalPoint[] {
  const sIn = shape.entryFrac
  const sOut = shape.exitFrac
  const sBowl = 1 - sIn - sOut
  const entryNorm = shape.entryPower + 1
  const exitNorm = shape.exitPower + 1
  const bowlSamples = 180
  const bowl: number[] = []
  let bowlIntegral = 0
  for (let index = 0; index < bowlSamples; index += 1) {
    const t = (index + 0.5) / bowlSamples
    let density = bowlDensity(t, shape)
    density *=
      1 +
      shape.ripple *
        Math.sin(Math.PI * 2 * shape.rippleFreq * t + shape.ripplePhase)
    density = Math.max(shape.floor * 0.35, density)
    bowl.push(density)
    bowlIntegral += density
  }
  bowlIntegral /= bowlSamples
  const bowlAngle = -(shape.alphaIn + shape.alphaOut)
  const points: LocalPoint[] = []
  let along = 0
  let lat = 0
  let theta = 0
  const ds = 1 / DIP_STEPS
  for (let index = 0; index <= DIP_STEPS; index += 1) {
    points.push({ along, lat })
    if (index === DIP_STEPS) break
    const s = (index + 0.5) * ds
    let kappa: number
    if (s < sIn) {
      kappa =
        ((shape.alphaIn * entryNorm) / sIn) *
        Math.pow(s / sIn, shape.entryPower)
    } else if (s < sIn + sBowl) {
      const t = (s - sIn) / sBowl
      const sample =
        bowl[Math.min(bowlSamples - 1, Math.floor(t * bowlSamples))] ?? 1
      kappa = (bowlAngle / sBowl) * (sample / bowlIntegral)
    } else {
      const t = (s - sIn - sBowl) / sOut
      kappa =
        ((shape.alphaOut * exitNorm) / sOut) * Math.pow(1 - t, shape.exitPower)
    }
    theta += kappa * ds
    along += Math.cos(theta) * ds
    lat += Math.sin(theta) * ds
  }
  scaleToArc(points, 1)
  return points
}

function bowlDensity(t: number, shape: DipShape): number {
  const center = clamp(0.5 + shape.bowlBias * 0.28, 0.18, 0.82)
  const peak = Math.exp(-((t - center) ** 2) / (2 * shape.sharp * shape.sharp))
  const endSpread = 2 * 0.09 * 0.09
  const ends =
    0.55 *
    (Math.exp(-(t * t) / endSpread) + Math.exp(-((t - 1) ** 2) / endSpread))
  const raw =
    shape.bowlShape >= 0
      ? 1 - shape.bowlShape + shape.bowlShape * peak
      : 1 + shape.bowlShape + -shape.bowlShape * ends
  return Math.max(shape.floor, raw)
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
  const cap = Math.min(length, cross) * 0.04
  let peak = 0
  for (const point of points) peak = Math.max(peak, Math.abs(point.lat))
  if (peak > cap) {
    const scale = cap / peak
    for (const point of points) point.lat *= scale
  }
  return points
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

function scaleToArc(points: LocalPoint[], arc: number): void {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]
    const point = points[index]
    length += Math.hypot(point.along - prev.along, point.lat - prev.lat)
  }
  if (!(length > 1e-8)) return
  const scale = arc / length
  for (const point of points) {
    point.along *= scale
    point.lat *= scale
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
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
