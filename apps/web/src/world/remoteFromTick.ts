import { idFromIndex, pieceIndex } from './groups.ts'
import type { MotionPacket } from './motion.ts'
import { MousePathSmoother } from './mousePathSmoother.ts'
import type { CursorTarget, RemoteHeld } from './models.ts'

export type TickPlayerPose = {
  playerId: string
  cursor: MotionPacket | null
  held: MotionPacket | null
  heldMemberIndices: readonly number[]
  heldAnchorPieceIndex: number
  heldGroupId: number
}

export type TickHolding = {
  playerId: string
  memberPieceIndices: readonly number[]
  anchorPieceIndex: number
  groupId: number
}

/**
 * Update remote cursor/held maps from already-decoded tick poses.
 * Callers decode proto MotionSample → MotionPacket before invoking.
 */
export function applyRemoteTickMaps(input: {
  localPlayerId: string
  cols: number
  rows: number
  players: readonly TickPlayerPose[]
  holdings: readonly TickHolding[]
  prevCursors: ReadonlyMap<string, CursorTarget>
  prevHeld: ReadonlyMap<string, RemoteHeld>
  cursorSmooth: Map<string, MousePathSmoother>
  heldSmooth: Map<string, MousePathSmoother>
}): {
  nextCursors: Map<string, CursorTarget>
  nextHeld: Map<string, RemoteHeld>
} {
  const holdingsByPlayer = new Map(
    input.holdings.map((h) => [h.playerId, h] as const),
  )
  const posesByPlayer = new Map(
    input.players.map((pose) => [pose.playerId, pose] as const),
  )
  const nextCursors = new Map(input.prevCursors)
  const liveCursorIds = new Set<string>()

  for (const pose of input.players) {
    if (pose.playerId === input.localPlayerId) continue
    if (pose.cursor) {
      const packet = pose.cursor
      nextCursors.set(pose.playerId, {
        x: packet.x,
        y: packet.y,
        hide: packet.hide,
      })
      if (packet.hide) {
        input.cursorSmooth.delete(pose.playerId)
      } else {
        liveCursorIds.add(pose.playerId)
        let smooth = input.cursorSmooth.get(pose.playerId)
        if (!smooth) {
          smooth = new MousePathSmoother({
            renderDelayMs: 200,
            cruiseSpeed: 1200,
            catchUpSec: 0.12,
            catchUpAccel: 14_000,
          })
          input.cursorSmooth.set(pose.playerId, smooth)
        }
        smooth.setTarget(packet.x, packet.y)
      }
    }
  }
  for (const id of input.cursorSmooth.keys()) {
    if (!liveCursorIds.has(id)) input.cursorSmooth.delete(id)
  }

  const heldCandidates = new Set<string>()
  for (const playerId of holdingsByPlayer.keys()) heldCandidates.add(playerId)
  for (const pose of input.players) {
    if (pose.held && !pose.held.hide) heldCandidates.add(pose.playerId)
  }

  const nextHeld = new Map<string, RemoteHeld>()
  for (const playerId of heldCandidates) {
    if (playerId === input.localPlayerId) continue
    const pose = posesByPlayer.get(playerId)
    const holding = holdingsByPlayer.get(playerId)
    const prev = input.prevHeld.get(playerId)
    if (pose?.held?.hide) {
      if (holding && prev) nextHeld.set(playerId, { ...prev })
      continue
    }
    const memberIndices =
      pose && pose.heldMemberIndices.length > 0
        ? pose.heldMemberIndices
        : holding && holding.memberPieceIndices.length > 0
          ? holding.memberPieceIndices
          : null
    const members = memberIndices
      ? memberIndices.map((i) => idFromIndex(i, input.cols))
      : (prev?.members ?? [])
    if (members.length === 0) continue
    const anchorIndex =
      pose && pose.held
        ? pose.heldAnchorPieceIndex
        : (holding?.anchorPieceIndex ??
          pieceIndex(prev?.anchorId ?? '', input.cols, input.rows))
    const groupId =
      pose && pose.held
        ? pose.heldGroupId
        : (holding?.groupId ??
          pieceIndex(prev?.group ?? '', input.cols, input.rows))
    if (anchorIndex === null || groupId === null) continue
    let x = prev?.x
    let y = prev?.y
    if (pose?.held && !pose.held.hide) {
      x = pose.held.x
      y = pose.held.y
    }
    if (x === undefined || y === undefined) continue
    nextHeld.set(playerId, {
      anchorId: idFromIndex(anchorIndex, input.cols),
      group: idFromIndex(groupId, input.cols),
      members,
      x,
      y,
    })
    if (pose?.held && !pose.held.hide) {
      let smooth = input.heldSmooth.get(playerId)
      if (!smooth) {
        smooth = new MousePathSmoother({ renderDelayMs: 160 })
        input.heldSmooth.set(playerId, smooth)
      }
      smooth.setTarget(x, y)
    }
  }
  for (const id of input.heldSmooth.keys()) {
    if (!nextHeld.has(id)) input.heldSmooth.delete(id)
  }

  return { nextCursors, nextHeld }
}
