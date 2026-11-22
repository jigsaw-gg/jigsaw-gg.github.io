/** Puzzle cut geometry. See `dev/architecture.md`. */
import type { PuzzleSetup } from '../core/puzzleSetup.ts'
import { jigsawCutImpl } from './cut.impl.ts'
import type { PuzzleModel } from './models.ts'
import { jigsawRandomImpl } from './random.impl.ts'

export type { PieceModel, Point, PuzzleModel } from './models.ts'

/**
 * Columns and rows for nearly square pieces near `pieceCount`. The product may differ.
 * @behavior Picks the grid minimizing piece stretch, then count error, then drift from ideal axes.
 * Returns `{ cols: 1, rows: 1 }` when inputs are non-finite or non-positive.
 */
export function chooseGrid(
  pieceCount: number,
  imageWidth: number,
  imageHeight: number,
): { cols: number; rows: number } {
  return jigsawCutImpl.chooseGrid(pieceCount, imageWidth, imageHeight)
}

/**
 * Builds piece polygon outlines from image dimensions, piece count, and cut seed.
 * @behavior Derives the grid via `chooseGrid`, generates interlocking edge cuts, and attaches padding from cut depth.
 * Emits an OTEL `piece-logic` span `puzzle.build` when telemetry is configured.
 */
export function buildPuzzle(setup: PuzzleSetup): PuzzleModel {
  return jigsawCutImpl.buildPuzzle(setup)
}

/**
 * Mulberry32 PRNG factory for a 32-bit seed.
 * @behavior Seed `0` is replaced with `0x6d2b79f5` before the first draw.
 */
export function mulberry32(seed: number): () => number {
  return jigsawRandomImpl.mulberry32(seed)
}

/**
 * Mixes two seeds into a non-zero 32-bit value for derived RNG streams.
 */
export function mixSeed(seed: number, salt: number): number {
  return jigsawRandomImpl.mixSeed(seed, salt)
}
