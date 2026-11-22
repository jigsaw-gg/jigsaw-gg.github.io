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
