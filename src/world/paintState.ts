import { cursorColor } from './groups.ts'
import type { MousePathSmoother } from './mousePathSmoother.ts'
import type { Placement } from './placement.ts'
import type { CursorTarget, RemoteCursor, RemoteHeld } from './models.ts'

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
  remoteHeldSmooth: ReadonlyMap<string, MousePathSmoother>
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
} {
  const nextCursors: RemoteCursor[] = []
  const remoteCursorPoses: {
    id: string
    x: number
    y: number
    targetX: number
    targetY: number
  }[] = []

  for (const [id, cursor] of input.remoteCursors) {
    if (cursor.hide) continue
    const smooth = input.remoteCursorSmooth.get(id)
    const pose = smooth?.step(input.dtSec, input.now) ?? {
      x: cursor.x,
      y: cursor.y,
    }
    const delayed = smooth?.delayedTarget()
    remoteCursorPoses.push({
      id,
      x: pose.x,
      y: pose.y,
      targetX: delayed?.x ?? cursor.x,
      targetY: delayed?.y ?? cursor.y,
    })
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
  for (const [playerId, held] of [...input.remoteHeld.entries()].sort((a, b) =>
    a[0] < b[0] ? 1 : -1,
  )) {
    raised.push(held.group)
    const anchor = composed.find((p) => p.id === held.anchorId)
    if (!anchor) continue
    const smooth = input.remoteHeldSmooth.get(playerId)
    const pose = smooth?.step(input.dtSec, input.now) ?? {
      x: held.x,
      y: held.y,
    }
    const dx = pose.x - anchor.x
    const dy = pose.y - anchor.y
    const memberSet = new Set(held.members)
    composed = composed.map((piece) =>
      memberSet.has(piece.id)
        ? { ...piece, x: piece.x + dx, y: piece.y + dy }
        : piece,
    )
  }
  if (input.localClaimedGroup) raised.push(input.localClaimedGroup)

  return {
    cursors: nextCursors,
    raisedGroups: raised,
    placements: composed,
    remoteCursorPoses,
  }
}
