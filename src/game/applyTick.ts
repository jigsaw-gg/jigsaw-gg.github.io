import type { PieceState, Tick } from '../gen/game_pb.ts'
import { dequantize } from '../puzzle/kinematics.ts'
import type { Placement } from '../puzzle/play.ts'
import { idFromIndex } from '../puzzle/world.ts'
import type { BoardSnapshotJson, PieceStateJson } from './gameClient.ts'

export function boardJsonToPlacements(
  board: BoardSnapshotJson,
  cols: number,
  template: readonly Placement[],
): Placement[] {
  const byIndex = new Map<number, PieceStateJson>()
  for (const piece of board.pieces) byIndex.set(piece.pieceIndex, piece)
  return template.map((base, index) => {
    const state = byIndex.get(index)
    if (!state) return { ...base }
    return {
      ...base,
      x: dequantize(state.xQ),
      y: dequantize(state.yQ),
      group: idFromIndex(state.groupId, cols),
    }
  })
}

export function applyPieceStates(
  current: Placement[],
  pieces: readonly PieceState[],
  cols: number,
  skipIds: ReadonlySet<string>,
): Placement[] {
  if (pieces.length === 0) return current
  const next = current.map((piece) => ({ ...piece }))
  for (const state of pieces) {
    const id = idFromIndex(state.pieceIndex, cols)
    if (skipIds.has(id)) continue
    const piece = next[state.pieceIndex]
    if (!piece) continue
    piece.x = dequantize(state.xQ)
    piece.y = dequantize(state.yQ)
    piece.group = idFromIndex(state.groupId, cols)
  }
  return next
}

export function applyTickBoard(
  current: Placement[],
  tick: Tick,
  cols: number,
  template: readonly Placement[],
  skipIds: ReadonlySet<string>,
): Placement[] {
  if (tick.resync) {
    const byIndex = new Map<number, PieceState>()
    for (const piece of tick.pieceDeltas) byIndex.set(piece.pieceIndex, piece)
    return template.map((base, index) => {
      const id = base.id
      if (skipIds.has(id)) {
        const local = current[index]
        return local ? { ...local } : { ...base }
      }
      const state = byIndex.get(index)
      if (!state) {
        const local = current[index]
        return local ? { ...local } : { ...base }
      }
      return {
        ...base,
        x: dequantize(state.xQ),
        y: dequantize(state.yQ),
        group: idFromIndex(state.groupId, cols),
      }
    })
  }
  return applyPieceStates(current, tick.pieceDeltas, cols, skipIds)
}

export function placementsToFinalPoses(
  placements: readonly Placement[],
  cols: number,
  rows: number,
  memberIds: readonly string[],
): PieceStateJson[] {
  const count = cols * rows
  const out: PieceStateJson[] = []
  for (const id of memberIds) {
    const piece = placements.find((p) => p.id === id)
    if (!piece) continue
    const index = piece.row * cols + piece.col
    if (index < 0 || index >= count) continue
    const groupParts = piece.group.split(':')
    const gCol = Number(groupParts[0])
    const gRow = Number(groupParts[1])
    const groupId =
      Number.isInteger(gCol) && Number.isInteger(gRow)
        ? gRow * cols + gCol
        : index
    out.push({
      pieceIndex: index,
      xQ: Math.round(piece.x * 32),
      yQ: Math.round(piece.y * 32),
      groupId,
      rev: 0,
    })
  }
  return out
}
