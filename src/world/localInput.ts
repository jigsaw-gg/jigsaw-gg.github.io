import { event } from '../otel/index.ts'
import { groupMembers, pieceIndex } from './groups.ts'
import { MotionSender, type MotionPacket } from './motion.ts'
import type { Placement } from './placement.ts'
import type { BuiltGeometry, LocalDrag, SyncApi } from './models.ts'

export type LocalInputSend = {
  sendCursor: (packet: MotionPacket) => void
  sendClaim: (
    pieceIndices: number[],
    anchorPieceIndex: number,
    clientClaimId: bigint,
  ) => void
  sendMerge: (input: {
    movingGroupId: number
    targetGroupId: number
    movingMembers: number[]
    targetMembers: number[]
    movingAnchorXQ: number
    movingAnchorYQ: number
    clientMergeId: bigint
  }) => void
  sendMoveHeld: (input: {
    anchorPieceIndex: number
    groupId: number
    members: number[]
    packet: MotionPacket
  }) => void
  sendRelease: (placements: Placement[], memberIds: readonly string[]) => void
  sendReleaseEmpty: () => void
}

export type LocalInputRefs = {
  built: () => BuiltGeometry | null
  resting: () => Placement[] | null
  localDrag: {
    get: () => LocalDrag | null
    set: (value: LocalDrag | null) => void
  }
  playerId: () => string
  applyBoard: (placements: Placement[]) => void
}

/**
 * Outbound cursor/drag reporting. Encoding to wire samples is the caller's job
 * via `send*` wrappers (play layer).
 */
export function createLocalInputApi(
  sessionId: string,
  send: LocalInputSend,
  refs: LocalInputRefs,
  counters: { claim: { current: bigint }; merge: { current: bigint } },
): { api: SyncApi; dispose: () => void; resetDragSender: () => void } {
  const cursorSender = new MotionSender({
    tolerancePx: 1.75,
    minGapMs: 28,
    maxGapMs: 140,
    absoluteEveryMs: 0,
  })
  const dragSender = new MotionSender({
    tolerancePx: 1,
    minGapMs: 28,
    maxGapMs: 120,
    absoluteEveryMs: 0,
  })
  let cursorShown = false
  let stopTimer = 0
  let dragStopTimer = 0
  const CURSOR_OTEL_MIN_MS = 50
  let lastLocalCursorOtelAt = 0

  const api: SyncApi = {
    reportPointer(x, y) {
      const now = performance.now()
      const packet = cursorSender.observe({ x, y, t: now })
      if (packet) {
        cursorShown = !packet.hide
        send.sendCursor(packet)
        if (now - lastLocalCursorOtelAt >= CURSOR_OTEL_MIN_MS) {
          lastLocalCursorOtelAt = now
          event('input', 'cursor.local', {
            'jigsaw.game.id': sessionId,
            'jigsaw.player.id': refs.playerId(),
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
          })
        }
      }
      window.clearTimeout(stopTimer)
      stopTimer = window.setTimeout(() => {
        const anchor = cursorSender.flushAnchor()
        if (anchor) send.sendCursor(anchor)
      }, 70)
    },
    reportPointerGone() {
      window.clearTimeout(stopTimer)
      const packet = cursorSender.conceal()
      if (cursorShown || !packet.hide) send.sendCursor(packet)
      cursorShown = false
      event('input', 'cursor.local', {
        'jigsaw.game.id': sessionId,
        'jigsaw.player.id': refs.playerId(),
        hide: true,
      })
    },
    reportDrag(placements, anchorId) {
      const geo = refs.built()
      if (!geo) return
      const anchor = placements.find((piece) => piece.id === anchorId)
      if (!anchor) return
      const members = groupMembers(placements, anchor.group)
      const signature = `${anchorId}|${members.join(',')}`
      let held = refs.localDrag.get()
      const groupChanged = held !== null && held.group !== anchor.group
      const prevMembers = held?.members ?? []
      const prevSet = new Set(prevMembers)
      const addedIds = held ? members.filter((id) => !prevSet.has(id)) : []
      const merged = groupChanged || addedIds.length > 0

      if (held && merged) {
        const toIndex = (ids: readonly string[]) =>
          ids
            .map((id) => pieceIndex(id, geo.cols, geo.rows))
            .filter((v): v is number => v !== null)

        if (groupChanged) {
          const movingGroupId = pieceIndex(held.group, geo.cols, geo.rows)
          const targetGroupId = pieceIndex(anchor.group, geo.cols, geo.rows)
          const movingMembers = toIndex(prevMembers)
          const targetMembers = toIndex(
            members.filter((id) => !prevSet.has(id)),
          )
          if (
            movingGroupId !== null &&
            targetGroupId !== null &&
            movingGroupId !== targetGroupId &&
            movingMembers.length > 0 &&
            targetMembers.length > 0
          ) {
            const mergeId = counters.merge.current
            counters.merge.current += 1n
            send.sendMerge({
              movingGroupId,
              targetGroupId,
              movingMembers,
              targetMembers,
              movingAnchorXQ: Math.round(anchor.x * 32),
              movingAnchorYQ: Math.round(anchor.y * 32),
              clientMergeId: mergeId,
            })
          }
        } else {
          // Members grew but group id stayed put: infer former neighbor
          // groups from the resting board (still unmerged) and merge onto held.
          const targetGroupId = pieceIndex(held.group, geo.cols, geo.rows)
          if (targetGroupId !== null) {
            const resting = refs.resting() ?? []
            const byNeighbor = new Map<string, string[]>()
            for (const id of addedIds) {
              const rest = resting.find((piece) => piece.id === id)
              const neighborGroup = rest?.group ?? id
              if (neighborGroup === held.group) continue
              const list = byNeighbor.get(neighborGroup) ?? []
              list.push(id)
              byNeighbor.set(neighborGroup, list)
            }
            for (const [neighborGroup, movingIds] of byNeighbor) {
              const movingGroupId = pieceIndex(
                neighborGroup,
                geo.cols,
                geo.rows,
              )
              if (movingGroupId === null || movingGroupId === targetGroupId) {
                continue
              }
              const mergeId = counters.merge.current
              counters.merge.current += 1n
              const neighborAnchor =
                resting.find((piece) => piece.group === neighborGroup) ??
                resting.find((piece) => piece.id === movingIds[0])
              send.sendMerge({
                movingGroupId,
                targetGroupId,
                movingMembers: toIndex(movingIds),
                targetMembers: toIndex(prevMembers),
                movingAnchorXQ: Math.round(
                  (neighborAnchor?.x ?? anchor.x) * 32,
                ),
                movingAnchorYQ: Math.round(
                  (neighborAnchor?.y ?? anchor.y) * 32,
                ),
                clientMergeId: mergeId,
              })
            }
          }
        }
      }

      if (!held) {
        const claimId = counters.claim.current
        counters.claim.current += 1n
        const indices = members
          .map((id) => pieceIndex(id, geo.cols, geo.rows))
          .filter((v): v is number => v !== null)
        const anchorIndex = pieceIndex(anchorId, geo.cols, geo.rows)
        if (anchorIndex === null || indices.length === 0) return
        held = {
          anchorId,
          group: anchor.group,
          members,
          signature,
          sends: 0,
          claimId,
          claimed: false,
        }
        refs.localDrag.set(held)
        send.sendClaim(indices, anchorIndex, claimId)
      } else {
        held.anchorId = anchorId
        held.group = anchor.group
        held.members = members
        held.signature = signature
      }

      const force = merged || held.sends === 0
      if (force) dragSender.reset()
      const packet = dragSender.observe(
        { x: anchor.x, y: anchor.y, t: performance.now() },
        force,
      )
      if (packet) {
        held.sends += 1
        const anchorIndex = pieceIndex(held.anchorId, geo.cols, geo.rows)
        const groupId = pieceIndex(held.group, geo.cols, geo.rows)
        if (anchorIndex === null || groupId === null) return
        send.sendMoveHeld({
          anchorPieceIndex: anchorIndex,
          groupId,
          members: held.members
            .map((id) => pieceIndex(id, geo.cols, geo.rows))
            .filter((v): v is number => v !== null),
          packet,
        })
      }

      window.clearTimeout(dragStopTimer)
      dragStopTimer = window.setTimeout(() => {
        const current = refs.localDrag.get()
        if (!current) return
        const anchorPacket = dragSender.flushAnchor()
        if (!anchorPacket) return
        const geoNow = refs.built()
        if (!geoNow) return
        const a = pieceIndex(current.anchorId, geoNow.cols, geoNow.rows)
        const g = pieceIndex(current.group, geoNow.cols, geoNow.rows)
        if (a === null || g === null) return
        send.sendMoveHeld({
          anchorPieceIndex: a,
          groupId: g,
          members: current.members
            .map((id) => pieceIndex(id, geoNow.cols, geoNow.rows))
            .filter((v): v is number => v !== null),
          packet: anchorPacket,
        })
      }, 70)
    },
    reportDragEnd(placements) {
      const held = refs.localDrag.get()
      const geo = refs.built()
      const anchorPacket = dragSender.flushAnchor()
      if (held && anchorPacket && geo) {
        const a = pieceIndex(held.anchorId, geo.cols, geo.rows)
        const g = pieceIndex(held.group, geo.cols, geo.rows)
        if (a !== null && g !== null) {
          send.sendMoveHeld({
            anchorPieceIndex: a,
            groupId: g,
            members: held.members
              .map((id) => pieceIndex(id, geo.cols, geo.rows))
              .filter((v): v is number => v !== null),
            packet: anchorPacket,
          })
        }
      }
      if (held) {
        send.sendRelease(placements, held.members)
      }
      refs.localDrag.set(null)
      dragSender.reset()
      window.clearTimeout(dragStopTimer)
      refs.applyBoard(placements.map((p) => ({ ...p })))
    },
    reportDragCancel() {
      const held = refs.localDrag.get()
      if (held) send.sendReleaseEmpty()
      refs.localDrag.set(null)
      dragSender.reset()
      window.clearTimeout(dragStopTimer)
    },
  }

  return {
    api,
    resetDragSender: () => dragSender.reset(),
    dispose: () => {
      window.clearTimeout(stopTimer)
      window.clearTimeout(dragStopTimer)
    },
  }
}
