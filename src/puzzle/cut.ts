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
      const cut = razorCut(rngFor(setup.seed, 1, col, boundary), cellH)
      maxDepth = Math.max(maxDepth, cut.depth)
      const y = boundary * cellH
      const x = col * cellW
      horizontal.set(
        edgeKey(col, boundary),
        placeCut(x, y, x + cellW, y, cut, true),
      )
    }
  }

  for (let boundary = 1; boundary < cols; boundary += 1) {
    for (let row = 0; row < rows; row += 1) {
      const cut = razorCut(rngFor(setup.seed, 2, boundary, row), cellW)
      maxDepth = Math.max(maxDepth, cut.depth)
      const x = boundary * cellW
      const y = row * cellH
      vertical.set(
        edgeKey(boundary, row),
        placeCut(x, y, x, y + cellH, cut, false),
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
      append(
        points,
        row === rows - 1
          ? straight(x + cellW, y + cellH, x, y + cellH)
          : (horizontal.get(edgeKey(col, row + 1)) ??
              straight(x + cellW, y + cellH, x, y + cellH)),
        true,
      )
      append(
        points,
        col === 0
          ? straight(x, y + cellH, x, y)
          : (vertical.get(edgeKey(col, row)) ?? straight(x, y + cellH, x, y)),
        true,
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

interface RazorCut {
  sign: number
  depth: number
  samples: Array<{ t: number; o: number }>
}

function razorCut(rng: () => number, cross: number): RazorCut {
  const wobble = () => (rng() - 0.5) * 0.1
  const neck = 0.34 + rng() * 0.08
  const half = 0.1 + rng() * 0.035
  const samples = [
    { t: 0, o: 0 },
    { t: neck - half * 1.15, o: 0 },
    { t: neck - half * 0.55, o: 0.22 + wobble() },
    { t: neck - half * 0.15, o: 0.62 + wobble() },
    { t: neck + half * 0.2, o: 1.02 + wobble() },
    { t: neck + half * 0.55, o: 1.12 + wobble() },
    { t: neck + half * 0.95, o: 0.58 + wobble() },
    { t: neck + half * 1.3, o: 0.18 + wobble() },
    { t: Math.min(0.96, neck + half * 1.75), o: 0 },
    { t: 1, o: 0 },
  ]
  samples.sort((a, b) => a.t - b.t)
  return {
    sign: rng() < 0.5 ? -1 : 1,
    depth: cross * (0.18 + rng() * 0.07),
    samples: samples.map((sample) => ({
      t: Math.min(1, Math.max(0, sample.t)),
      o: Math.max(0, sample.o),
    })),
  }
}

function placeCut(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cut: RazorCut,
  horizontal: boolean,
): Point[] {
  return cut.samples.map((sample) => {
    const x = x0 + (x1 - x0) * sample.t
    const y = y0 + (y1 - y0) * sample.t
    const offset = sample.o * cut.depth * cut.sign
    return horizontal ? { x, y: y + offset } : { x: x + offset, y }
  })
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
