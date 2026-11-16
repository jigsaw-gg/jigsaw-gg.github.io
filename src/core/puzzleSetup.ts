/** Shared puzzle setup used by lobby HTTP, cut, and session cache. */

export interface PuzzleSetup {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  pieceCount: number
  seed: number
}
