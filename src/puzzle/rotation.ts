import { dequantize, quantize } from './kinematics.ts'
import type { Bounds, Placement } from './play.ts'

/**
 * Piece orientation is a count of clockwise quarter turns, 0..3. A piece
 * turns about the centre of its upright cell box, so its x, y (that box's
 * top-left corner) do not change when it turns in place.
 */

/** Any integer to 0..3. Anything else is upright. */
export function normalizeTurns(turns: number): number {
  if (!Number.isInteger(turns)) return 0
  return ((turns % 4) + 4) % 4
}

/** One clockwise quarter turn on screen (y grows downward) is (x, y) → (-y, x). */
export function turnVector(
  x: number,
  y: number,
  turns: number,
): { x: number; y: number } {
  switch (normalizeTurns(turns)) {
    case 1:
      return { x: 0 - y, y: x }
    case 2:
      return { x: 0 - x, y: 0 - y }
    case 3:
      return { x: y, y: 0 - x }
    default:
      return { x, y }
  }
}

/**
 * Where the grid neighbour at (dc, dr) sits relative to a piece when both
 * have the same rotation and are joined.
 */
export function fittedOffset(
  dc: number,
  dr: number,
  cellW: number,
  cellH: number,
  rotation: number,
): { x: number; y: number } {
  return turnVector(dc * cellW, dr * cellH, rotation)
}

/**
 * The box a piece covers on the table. Cells are not square, so a piece on
 * its side covers cellH by cellW around the same centre.
 */
export function pieceFootprint(
  piece: { x: number; y: number; rotation: number },
  cellW: number,
  cellH: number,
): Bounds {
  if (normalizeTurns(piece.rotation) % 2 === 0) {
    return {
      minX: piece.x,
      minY: piece.y,
      maxX: piece.x + cellW,
      maxY: piece.y + cellH,
    }
  }
  const inset = (cellW - cellH) / 2
  return {
    minX: piece.x + inset,
    minY: piece.y - inset,
    maxX: piece.x + inset + cellH,
    maxY: piece.y - inset + cellW,
  }
}

/**
 * Turn a group by clockwise quarter turns about one of its pieces. The pivot
 * keeps its place and every other member swings around it.
 *
 * Poses are snapped to wire quanta first, so the turn is integer arithmetic:
 * members stay exactly as far apart as they were, and four turns give back
 * the poses the group started from.
 */
export function rotateGroup(
  placements: Placement[],
  group: string,
  pivotId: string,
  turns: number,
): Placement[] {
  const steps = normalizeTurns(turns)
  if (steps === 0) return placements
  const pivot = placements.find((piece) => piece.id === pivotId)
  if (!pivot || pivot.group !== group) return placements
  const pivotX = quantize(pivot.x)
  const pivotY = quantize(pivot.y)
  return placements.map((piece) => {
    if (piece.group !== group) return piece
    const arm = turnVector(
      quantize(piece.x) - pivotX,
      quantize(piece.y) - pivotY,
      steps,
    )
    return {
      ...piece,
      x: dequantize(pivotX + arm.x),
      y: dequantize(pivotY + arm.y),
      rotation: normalizeTurns(piece.rotation + steps),
    }
  })
}
