import { grabPickAtRest } from './grabPresentation.ts'
import { cursorColor } from './groups.ts'
import type { MousePathSmoother } from './mousePathSmoother.ts'
import type { Placement } from './placement.ts'
import type {
  CursorTarget,
  RemoteCursor,
  RemoteHeld,
  RemotePresentationPhase,
} from './models.ts'

/* placeholder 1 */
/** Resting anchor matches painted hold — drop release overlay. */
const SETTLE_PX = 6
/** Painted cursor at the rest pick point — attach hold overlay. */
const GRAB_COMMIT_PX = 28
/** After settle, only chase wire when it is already near the painted cursor. */
const WIRE_HANDOFF_PX = 96

/** Observer-painted remote hold anchor (for OTEL / OpenObserve). */
export type RemotePiecePoseOtel = {
  playerId: string
  anchorId: string
  presentationPhase: RemotePresentationPhase['kind'] | 'none'
  cursorX: number
  cursorY: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  restX: number
  restY: number
  gapPx: number
}

export function cursorsEqual(
  left: readonly RemoteCursor[],
  right: readonly RemoteCursor[],
): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    const a = left[i]
    const b = right[i]
    if (!a || !b || a.id !== b.id) return false
    if (Math.abs(a.x - b.x) > 0.2 || Math.abs(a.y - b.y) > 0.2) return false
  }
  return true
}

export function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}

export function boardsEqual(
  left: readonly Placement[],
  right: readonly Placement[],
): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    const a = left[i]
    const b = right[i]
    if (!a || !b) return false
    if (a.group !== b.group) return false
    if (Math.abs(a.x - b.x) > 0.05 || Math.abs(a.y - b.y) > 0.05) return false
  }
  return true
}

export function composePaintFrame(input: {
  resting: readonly Placement[]
  remoteCursors: ReadonlyMap<string, CursorTarget>
  remoteCursorSmooth: ReadonlyMap<string, MousePathSmoother>
  remoteHeld: ReadonlyMap<string, RemoteHeld>
  presentation: Map<string, RemotePresentationPhase>
  localClaimedGroup: string | null
  peerNames: ReadonlyMap<string, string>
  fallbackName: string
  dtSec: number
  now: number
}): {
  cursors: RemoteCursor[]
  raisedGroups: string[]
  placements: Placement[]
  remoteCursorPoses: {
    id: string
    x: number
    y: number
    targetX: number
    targetY: number
  }[]
  presentationEvents: {
    playerId: string
    name: 'settling_complete' | 'grab_committed'
    gapPx: number
  }[]
  remotePiecePoses: RemotePiecePoseOtel[]
} {
  const nextCursors: RemoteCursor[] = []
  const remoteCursorPoses: {
    id: string
    x: number
    y: number
    targetX: number
    targetY: number
  }[] = []

  const paintedByPlayer = new Map<string, { x: number; y: number }>()
  const presentationEvents: {
    playerId: string
    name: 'settling_complete' | 'grab_committed'
    gapPx: number
  }[] = []

  const paintIds = new Set<string>([
    ...input.remoteCursors.keys(),
    ...input.remoteCursorSmooth.keys(),
    ...input.presentation.keys(),
  ])

  for (const id of paintIds) {
    const cursor = input.remoteCursors.get(id)
    const phase = input.presentation.get(id)
    const smooth = input.remoteCursorSmooth.get(id)
    if (!cursor && !smooth) continue
    const wire = cursor ?? { x: 0, y: 0, hide: true }
    if (
      wire.hide &&
      phase?.kind !== 'settling' &&
      phase?.kind !== 'approaching_grab'
    )
      continue

    if (phase?.kind === 'settling' && smooth) {
      const restingAnchor = input.resting.find((p) => p.id === phase.anchorId)
      if (restingAnchor) {
        smooth.setTarget(
          restingAnchor.x - phase.offsetX,
          restingAnchor.y - phase.offsetY,
          input.now,
        )
      }
    }

    if (phase?.kind === 'approaching_grab' && smooth) {
      const restingAnchor = input.resting.find((p) => p.id === phase.anchorId)
      if (restingAnchor) {
        const target = phase.offsetReady
          ? grabPickAtRest(restingAnchor, phase.offsetX, phase.offsetY)
          : { x: restingAnchor.x, y: restingAnchor.y }
        smooth.setTarget(target.x, target.y, input.now)
      }
    }

    const pose = smooth?.step(input.dtSec, input.now) ?? {
      x: wire.x,
      y: wire.y,
    }

    const delayed = smooth?.delayedTarget()
    remoteCursorPoses.push({
      id,
      x: pose.x,
      y: pose.y,
      targetX: delayed?.x ?? wire.x,
      targetY: delayed?.y ?? wire.y,
    })
    paintedByPlayer.set(id, pose)
    nextCursors.push({
      id,
      name: input.peerNames.get(id) ?? input.fallbackName,
      color: cursorColor(id),
      x: pose.x,
      y: pose.y,
    })
  }
  nextCursors.sort((a, b) => a.id.localeCompare(b.id))

  let composed = input.resting.map((p) => ({ ...p }))
  const raised: string[] = []

  const applyHoldOverlay = (
    playerId: string,
    anchorId: string,
    members: readonly string[],
    offsetX: number,
    offsetY: number,
    raiseGroup: string | null,
  ): void => {
    const anchor = composed.find((p) => p.id === anchorId)
    if (!anchor) return
    const painted = paintedByPlayer.get(playerId)
    if (!painted) return
    const heldAnchorX = painted.x + offsetX
    const heldAnchorY = painted.y + offsetY
    const dx = heldAnchorX - anchor.x
    const dy = heldAnchorY - anchor.y
    if (raiseGroup) raised.push(raiseGroup)
    const memberSet = new Set(members)
    composed = composed.map((piece) =>
      memberSet.has(piece.id)
        ? { ...piece, x: piece.x + dx, y: piece.y + dy }
        : piece,
    )
  }

  for (const [playerId, phase] of input.presentation) {
    if (phase.kind !== 'approaching_grab') continue
    const painted = paintedByPlayer.get(playerId)
    const restingAnchor = input.resting.find((p) => p.id === phase.anchorId)
    if (!painted || !restingAnchor || !phase.offsetReady) continue
    const pick = grabPickAtRest(restingAnchor, phase.offsetX, phase.offsetY)
    const gapPx = Math.hypot(painted.x - pick.x, painted.y - pick.y)
    if (gapPx > GRAB_COMMIT_PX) continue
    presentationEvents.push({
      playerId,
      name: 'grab_committed',
      gapPx,
    })
    input.presentation.set(playerId, { kind: 'holding' })
    const handoffSmooth = input.remoteCursorSmooth.get(playerId)
    const wire = input.remoteCursors.get(playerId)
    if (handoffSmooth) {
      handoffSmooth.commitPresentedPose(input.now)
      if (wire && !wire.hide) {
        handoffSmooth.setTarget(wire.x, wire.y, input.now)
      }
    }
  }

  for (const [playerId, held] of [...input.remoteHeld.entries()].sort((a, b) =>
    a[0] < b[0] ? 1 : -1,
  )) {
    const phase = input.presentation.get(playerId)?.kind
    if (phase === 'approaching_grab') continue
    applyHoldOverlay(
      playerId,
      held.anchorId,
      held.members,
      held.offsetX,
      held.offsetY,
      held.group,
    )
  }

  for (const [playerId, phase] of input.presentation) {
    if (phase.kind !== 'settling') continue
    const restingAnchor = input.resting.find((p) => p.id === phase.anchorId)
    applyHoldOverlay(
      playerId,
      phase.anchorId,
      phase.members,
      phase.offsetX,
      phase.offsetY,
      restingAnchor?.group ?? null,
    )
    const anchor = restingAnchor
    const painted = paintedByPlayer.get(playerId)
    if (!anchor || !painted) continue
    const dx = painted.x + phase.offsetX - anchor.x
    const dy = painted.y + phase.offsetY - anchor.y
    const gapPx = Math.hypot(dx, dy)
    if (gapPx <= SETTLE_PX) {
      presentationEvents.push({
        playerId,
        name: 'settling_complete',
        gapPx,
      })
      input.presentation.set(playerId, { kind: 'tracking' })
      const handoffSmooth = input.remoteCursorSmooth.get(playerId)
      const painted = paintedByPlayer.get(playerId)
      const wire = input.remoteCursors.get(playerId)
      if (handoffSmooth && painted) {
        handoffSmooth.commitPresentedPose(input.now)
        if (wire && !wire.hide) {
          const wireGap = Math.hypot(wire.x - painted.x, wire.y - painted.y)
          if (wireGap <= WIRE_HANDOFF_PX) {
            handoffSmooth.setTarget(wire.x, wire.y, input.now)
          }
        }
      }
    }
  }
  if (input.localClaimedGroup) raised.push(input.localClaimedGroup)

  const remotePiecePoses: RemotePiecePoseOtel[] = []

  const pushPiecePose = (
    playerId: string,
    anchorId: string,
    offsetX: number,
    offsetY: number,
    phase: RemotePresentationPhase['kind'] | 'none',
  ): void => {
    const restingAnchor = input.resting.find((p) => p.id === anchorId)
    const paintedAnchor = composed.find((p) => p.id === anchorId)
    const cursor = paintedByPlayer.get(playerId)
    if (!restingAnchor || !paintedAnchor || !cursor) return
    const gapPx = Math.hypot(
      paintedAnchor.x - restingAnchor.x,
      paintedAnchor.y - restingAnchor.y,
    )
    remotePiecePoses.push({
      playerId,
      anchorId,
      presentationPhase: phase,
      cursorX: cursor.x,
      cursorY: cursor.y,
      offsetX,
      offsetY,
      x: paintedAnchor.x,
      y: paintedAnchor.y,
      restX: restingAnchor.x,
      restY: restingAnchor.y,
      gapPx,
    })
  }

  for (const [playerId, held] of input.remoteHeld) {
    const presentation = input.presentation.get(playerId)
    const phaseKind = presentation?.kind ?? 'holding'
    const telemetryPhase =
      phaseKind === 'holding'
        ? 'holding'
        : phaseKind === 'approaching_grab'
          ? 'approaching_grab'
          : phaseKind
    const offsetX =
      presentation?.kind === 'approaching_grab'
        ? presentation.offsetX
        : held.offsetX
    const offsetY =
      presentation?.kind === 'approaching_grab'
        ? presentation.offsetY
        : held.offsetY
    pushPiecePose(playerId, held.anchorId, offsetX, offsetY, telemetryPhase)
  }
  for (const [playerId, phase] of input.presentation) {
    if (phase.kind !== 'settling') continue
    pushPiecePose(
      playerId,
      phase.anchorId,
      phase.offsetX,
      phase.offsetY,
      'settling',
    )
  }
  remotePiecePoses.sort((a, b) => a.playerId.localeCompare(b.playerId))

  return {
    cursors: nextCursors,
    raisedGroups: raised,
    placements: composed,
    remoteCursorPoses,
    presentationEvents,
    remotePiecePoses,
  }
}
