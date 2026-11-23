import { grabOffsetTrustworthy } from './grabPresentation.ts'
import { idFromIndex, pieceIndex } from './groups.ts'
import type { MotionPacket } from './motion.ts'
import { MousePathSmoother } from './mousePathSmoother.ts'
import type { Placement } from './placement.ts'
import type {
  CursorTarget,
  RemoteHeld,
  RemotePresentationPhase,
} from './models.ts'

const WIRE_HANDOFF_PX = 96

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

function ensureSmoother(
  smoothers: Map<string, MousePathSmoother>,
  playerId: string,
  presentationDelayMs: number,
): MousePathSmoother {
  let smooth = smoothers.get(playerId)
  if (!smooth) {
    smooth = new MousePathSmoother({
      renderDelayMs: presentationDelayMs,
      cruiseSpeed: 1200,
      catchUpSec: 0.12,
      catchUpAccel: 14_000,
    })
    smoothers.set(playerId, smooth)
  }
  return smooth
}

function feedCursorTarget(
  smooth: MousePathSmoother,
  phase: RemotePresentationPhase | undefined,
  wire: CursorTarget,
  nowMs: number,
): void {
  if (phase?.kind === 'settling' || phase?.kind === 'approaching_grab') {
    return
  }
  if (wire.hide) return
  const painted = smooth.paintedPose()
  // Defer chasing far-ahead wire only after release (tracking). During a hold,
  // painted can legitimately lag wire by more than WIRE_HANDOFF_PX — still feed.
  if (painted && phase?.kind === 'tracking') {
    const wireGap = Math.hypot(wire.x - painted.x, wire.y - painted.y)
    if (wireGap > WIRE_HANDOFF_PX) {
      return
    }
  }
  smooth.setTarget(wire.x, wire.y, nowMs)
}

/**
 * Update remote cursor/held maps from already-decoded tick poses.
 * Callers decode proto MotionSample → MotionPacket before invoking.
 * Apply tick board to resting before calling so release landing targets are correct.
 */
export function applyRemoteTickMaps(input: {
  localPlayerId: string
  cols: number
  rows: number
  resting: readonly Placement[]
  players: readonly TickPlayerPose[]
  holdings: readonly TickHolding[]
  prevCursors: ReadonlyMap<string, CursorTarget>
  prevHeld: ReadonlyMap<string, RemoteHeld>
  cursorSmooth: Map<string, MousePathSmoother>
  presentation: Map<string, RemotePresentationPhase>
  presentationDelayMs: number
  nowMs?: number
}): {
  nextCursors: Map<string, CursorTarget>
  nextHeld: Map<string, RemoteHeld>
} {
  const now = input.nowMs ?? performance.now()
  const holdingsByPlayer = new Map(
    input.holdings.map((h) => [h.playerId, h] as const),
  )
  const posesByPlayer = new Map(
    input.players.map((pose) => [pose.playerId, pose] as const),
  )
  const nextCursors = new Map(input.prevCursors)
  const liveWireCursorIds = new Set<string>()

  for (const pose of input.players) {
    if (pose.playerId === input.localPlayerId) continue
    if (!pose.cursor) continue
    const packet = pose.cursor
    const wire: CursorTarget = {
      x: packet.x,
      y: packet.y,
      hide: packet.hide,
    }
    nextCursors.set(pose.playerId, wire)
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

    const cursorPacket = pose?.cursor
    const heldPacket = pose?.held && !pose.held.hide ? pose.held : null
    const anchorId = idFromIndex(anchorIndex, input.cols)
    const existingPhase = input.presentation.get(playerId)
    const approach =
      existingPhase?.kind === 'approaching_grab' ? existingPhase : null

    let offsetX = prev?.offsetX ?? 0
    let offsetY = prev?.offsetY ?? 0
    let offsetReady = approach?.offsetReady ?? false

    const trustOffset =
      heldPacket &&
      cursorPacket &&
      grabOffsetTrustworthy(heldPacket, cursorPacket)

    if (trustOffset) {
      offsetX = heldPacket.x - cursorPacket.x
      offsetY = heldPacket.y - cursorPacket.y
      offsetReady = true
    } else if (approach) {
      offsetX = approach.offsetX
      offsetY = approach.offsetY
    } else if (
      input.prevHeld.has(playerId) &&
      heldPacket &&
      cursorPacket &&
      !cursorPacket.hide &&
      !heldPacket.hide
    ) {
      offsetX = heldPacket.x - cursorPacket.x
      offsetY = heldPacket.y - cursorPacket.y
    } else if (!input.prevHeld.has(playerId)) {
      offsetX = 0
      offsetY = 0
      offsetReady = false
    }

    nextHeld.set(playerId, {
      anchorId,
      group: idFromIndex(groupId, input.cols),
      members,
      offsetX,
      offsetY,
    })
    if (approach) {
      input.presentation.set(playerId, {
        ...approach,
        offsetX,
        offsetY,
        offsetReady,
      })
    } else if (
      input.prevHeld.has(playerId) &&
      input.presentation.get(playerId)?.kind === 'holding'
    ) {
      input.presentation.set(playerId, { kind: 'holding' })
    } else {
      input.presentation.set(playerId, {
        kind: 'approaching_grab',
        anchorId,
        members: [...members],
        offsetX,
        offsetY,
        offsetReady,
      })
    }
  }

  for (const [playerId, prev] of input.prevHeld) {
    if (playerId === input.localPlayerId || nextHeld.has(playerId)) continue
    if (!input.resting.find((p) => p.id === prev.anchorId)) {
      input.presentation.set(playerId, { kind: 'tracking' })
      continue
    }
    input.presentation.set(playerId, {
      kind: 'settling',
      anchorId: prev.anchorId,
      members: [...prev.members],
      offsetX: prev.offsetX,
      offsetY: prev.offsetY,
    })
  }

  const remoteIds = new Set<string>([
    ...nextCursors.keys(),
    ...input.presentation.keys(),
  ])

  for (const playerId of remoteIds) {
    if (playerId === input.localPlayerId) continue
    const wire = nextCursors.get(playerId) ?? input.prevCursors.get(playerId)
    if (!wire) continue

    let phase = input.presentation.get(playerId)
    if (nextHeld.has(playerId)) {
      if (phase?.kind !== 'approaching_grab' && phase?.kind !== 'holding') {
        phase = { kind: 'holding' }
        input.presentation.set(playerId, phase)
      }
    } else if (
      phase?.kind === 'settling' ||
      phase?.kind === 'approaching_grab'
    ) {
      // paint frame owns completion / commit
    } else {
      phase = { kind: 'tracking' }
      input.presentation.set(playerId, phase)
    }

    if (phase?.kind === 'settling' || phase?.kind === 'approaching_grab') {
      liveWireCursorIds.add(playerId)
      ensureSmoother(input.cursorSmooth, playerId, input.presentationDelayMs)
      continue
    }

    if (wire.hide) continue
    liveWireCursorIds.add(playerId)
    const smooth = ensureSmoother(
      input.cursorSmooth,
      playerId,
      input.presentationDelayMs,
    )
    feedCursorTarget(smooth, phase, wire, now)
  }

  for (const id of [...input.cursorSmooth.keys()]) {
    const phase = input.presentation.get(id)?.kind
    if (phase === 'settling' || phase === 'approaching_grab') continue
    if (!liveWireCursorIds.has(id) && !nextHeld.has(id)) {
      input.cursorSmooth.delete(id)
    }
  }

  return { nextCursors, nextHeld }
}
