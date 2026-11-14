import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GameEvent_Kind,
  type ClaimResult,
  type GameEvent,
  type HeldGroup,
  type MergeResult,
  type PresenceUpdate,
  type Tick,
  type Welcome,
} from '../gen/game_pb.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { event, setPlayTransport } from '../otel/index.ts'
import { buildPuzzle } from '../puzzle/cut.ts'
import { MotionSender } from '../puzzle/kinematics.ts'
import { scatterPieces, type Placement } from '../puzzle/play.ts'
import type { PuzzleSetup } from '../puzzle/session.ts'
import {
  cursorColor,
  groupMembers,
  idFromIndex,
  pieceIndex,
} from '../puzzle/world.ts'
import {
  applyTickBoard,
  boardJsonToPlacements,
  placementsToFinalPoses,
} from './applyTick.ts'
import type { BoardSnapshotJson, PlayEndpoints } from './gameClient.ts'
import { MousePathSmoother } from './mousePathSmoother.ts'
import { sampleToPacket } from './motionCodec.ts'
import { GameSyncSession } from './syncSession.ts'

export interface RemoteCursor {
  id: string
  name: string
  color: string
  x: number
  y: number
}

interface LocalDrag {
  anchorId: string
  group: string
  members: string[]
  signature: string
  sends: number
  claimId: bigint
  claimed: boolean
}

interface SyncApi {
  reportPointer: (x: number, y: number) => void
  reportPointerGone: () => void
  reportDrag: (placements: Placement[], anchorId: string) => void
  reportDragEnd: (placements: Placement[]) => void
  reportDragCancel: () => void
}

export function useGameWorld(
  sessionId: string,
  player: { id: string; name: string },
  setup: PuzzleSetup | null,
  cols: number | null,
  rows: number | null,
  board: BoardSnapshotJson | null,
  play: PlayEndpoints | null,
  joinGeneration: number,
  applyPresence: (
    players: { playerId: string; displayName: string; online: boolean }[],
  ) => void,
  peerNames: ReadonlyMap<string, string>,
): {
  placements: Placement[] | null
  cursors: RemoteCursor[]
  raisedGroups: readonly string[]
  masterId: string | null
  yieldNonce: number
  transport: 'webtransport' | 'websocket' | null
  rttMs: number | null
  reportPointer: (x: number, y: number) => void
  reportPointerGone: () => void
  reportDrag: (placements: Placement[], anchorId: string) => void
  reportDragEnd: (placements: Placement[]) => void
  reportDragCancel: () => void
} {
  const built = useMemo(() => {
    if (!setup || cols === null || rows === null) return null
    const model = buildPuzzle(setup)
    const scattered = scatterPieces(model, setup.seed)
    return {
      key: `${sessionId}:${setup.seed}:${setup.pieceCount}:${setup.imageWidth}x${setup.imageHeight}`,
      cols,
      rows,
      cellW: scattered.cellW,
      cellH: scattered.cellH,
      template: scattered.placements,
    }
  }, [sessionId, setup, cols, rows])

  const [view, setView] = useState<Placement[] | null>(null)
  const [cursors, setCursors] = useState<RemoteCursor[]>([])
  const [raisedGroups, setRaisedGroups] = useState<readonly string[]>([])
  const [yieldNonce, setYieldNonce] = useState(0)
  const [transport, setTransportState] = useState<
    'webtransport' | 'websocket' | null
  >(null)
  const setTransport = useCallback(
    (kind: 'webtransport' | 'websocket' | null) => {
      setTransportState(kind)
      setPlayTransport(kind)
    },
    [],
  )
  const [rttMs, setRttMs] = useState<number | null>(null)

  const { messages } = useI18n()
  const restingRef = useRef<Placement[] | null>(null)
  const builtRef = useRef(built)
  const playerRef = useRef(player)
  const peerNamesRef = useRef(peerNames)
  const fallbackNameRef = useRef(messages.player.fallback)
  const applyPresenceRef = useRef(applyPresence)
  const localDragRef = useRef<LocalDrag | null>(null)
  const holdingsRef = useRef<HeldGroup[]>([])
  const remoteCursorRef = useRef(
    new Map<string, { x: number; y: number; hide: boolean }>(),
  )
  const remoteHeldRef = useRef(
    new Map<
      string,
      {
        anchorId: string
        group: string
        members: string[]
        /** Last tick target; display pose comes from remoteHeldSmoothRef. */
        x: number
        y: number
      }
    >(),
  )
  const remoteHeldSmoothRef = useRef(new Map<string, MousePathSmoother>())
  const remoteCursorSmoothRef = useRef(new Map<string, MousePathSmoother>())
  const claimCounter = useRef(1n)
  const mergeCounter = useRef(1n)
  const sessionRef = useRef<GameSyncSession | null>(null)

  const api = useRef<SyncApi>({
    reportPointer: () => {},
    reportPointerGone: () => {},
    reportDrag: () => {},
    reportDragEnd: () => {},
    reportDragCancel: () => {},
  })

  useEffect(() => {
    builtRef.current = built
    playerRef.current = player
    peerNamesRef.current = peerNames
    fallbackNameRef.current = messages.player.fallback
    applyPresenceRef.current = applyPresence
  }, [built, player, peerNames, messages.player.fallback, applyPresence])

  useEffect(() => {
    if (!built || !play || joinGeneration < 1) return

    remoteHeldSmoothRef.current.clear()
    remoteCursorSmoothRef.current.clear()

    const initial =
      board && board.pieces.length > 0
        ? boardJsonToPlacements(board, built.cols, built.template)
        : built.template.map((piece) => ({ ...piece }))
    restingRef.current = initial

    // Absolute every knot until the server honors MotionSample.absolute for
    // relative deltas (proto contract). Relative + absolute-blind repair puts
    // the remote cursor near the origin until the next absolute/anchor sample.
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
    let frame = 0
    let closed = false
    let welcomeBoardApplied = false
    queueMicrotask(() => {
      if (closed) return
      setView(initial)
    })

    const skipHeldIds = (): Set<string> => {
      const ids = new Set<string>()
      const local = localDragRef.current
      if (local?.claimed) {
        for (const id of local.members) ids.add(id)
      }
      for (const held of remoteHeldRef.current.values()) {
        for (const id of held.members) ids.add(id)
      }
      return ids
    }

    // Resting board only — paint() composes remote holds onto the displayed view.
    // Setting view here would flash the pre-drag pose between ticks (~blink).
    const applyBoard = (placements: Placement[]) => {
      restingRef.current = placements
    }

    const onWelcome = (welcome: Welcome) => {
      applyPresenceRef.current(welcome.players)
      holdingsRef.current = [...welcome.holdings]
      if (welcome.board && builtRef.current && !welcomeBoardApplied) {
        welcomeBoardApplied = true
        applyBoard(
          boardJsonToPlacements(
            {
              boardRev: Number(welcome.board.boardRev),
              pieces: welcome.board.pieces.map((p) => ({
                pieceIndex: p.pieceIndex,
                xQ: p.xQ,
                yQ: p.yQ,
                groupId: p.groupId,
                rev: p.rev,
              })),
            },
            builtRef.current.cols,
            builtRef.current.template,
          ),
        )
      }
    }

    const onTick = (tick: Tick) => {
      const geo = builtRef.current
      const current = restingRef.current
      if (!geo || !current) return
      holdingsRef.current = [...tick.holdings]

      const holdingsByPlayer = new Map(
        tick.holdings.map((h) => [h.playerId, h] as const),
      )
      const posesByPlayer = new Map(
        tick.players.map((pose) => [pose.playerId, pose] as const),
      )
      const nextCursors = new Map(remoteCursorRef.current)
      const liveCursorIds = new Set<string>()
      for (const pose of tick.players) {
        if (pose.playerId === playerRef.current.id) continue
        if (pose.cursor) {
          const packet = sampleToPacket(pose.cursor)
          nextCursors.set(pose.playerId, {
            x: packet.x,
            y: packet.y,
            hide: packet.hide,
          })
          if (packet.hide) {
            remoteCursorSmoothRef.current.delete(pose.playerId)
          } else {
            liveCursorIds.add(pose.playerId)
            let smooth = remoteCursorSmoothRef.current.get(pose.playerId)
            if (!smooth) {
              smooth = new MousePathSmoother({
                renderDelayMs: 200,
                cruiseSpeed: 1200,
                catchUpSec: 0.12,
                catchUpAccel: 14_000,
              })
              remoteCursorSmoothRef.current.set(pose.playerId, smooth)
            }
            smooth.setTarget(packet.x, packet.y)
          }
        }
      }
      for (const id of remoteCursorSmoothRef.current.keys()) {
        if (!liveCursorIds.has(id)) remoteCursorSmoothRef.current.delete(id)
      }

      // Prefer tick.holdings for who is holding; also accept pose.held when the
      // holdings list is sparse. Keep last motion/members across omitted samples.
      const heldCandidates = new Set<string>()
      for (const playerId of holdingsByPlayer.keys())
        heldCandidates.add(playerId)
      for (const pose of tick.players) {
        if (pose.held && !pose.held.hide) heldCandidates.add(pose.playerId)
      }
      const nextHeld = new Map<
        string,
        {
          anchorId: string
          group: string
          members: string[]
          x: number
          y: number
        }
      >()
      for (const playerId of heldCandidates) {
        if (playerId === playerRef.current.id) continue
        const pose = posesByPlayer.get(playerId)
        const holding = holdingsByPlayer.get(playerId)
        const prev = remoteHeldRef.current.get(playerId)
        // hide=true ⇒ no motion sample yet; holdings still owns the hold.
        // Keep last pose (proto PlayerPose.held); do not clear mid-claim.
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
          ? memberIndices.map((i) => idFromIndex(i, geo.cols))
          : (prev?.members ?? [])
        if (members.length === 0) continue
        const anchorIndex =
          pose && pose.held
            ? pose.heldAnchorPieceIndex
            : (holding?.anchorPieceIndex ??
              pieceIndex(prev?.anchorId ?? '', geo.cols, geo.rows))
        const groupId =
          pose && pose.held
            ? pose.heldGroupId
            : (holding?.groupId ??
              pieceIndex(prev?.group ?? '', geo.cols, geo.rows))
        if (anchorIndex === null || groupId === null) continue
        let x = prev?.x
        let y = prev?.y
        if (pose?.held && !pose.held.hide) {
          const packet = sampleToPacket(pose.held)
          x = packet.x
          y = packet.y
        }
        if (x === undefined || y === undefined) continue
        nextHeld.set(playerId, {
          anchorId: idFromIndex(anchorIndex, geo.cols),
          group: idFromIndex(groupId, geo.cols),
          members,
          x,
          y,
        })
        if (pose?.held && !pose.held.hide) {
          let smooth = remoteHeldSmoothRef.current.get(playerId)
          if (!smooth) {
            // Same intentional render lag as cursors — chase delayed history,
            // not a projected "now" pose.
            smooth = new MousePathSmoother({ renderDelayMs: 160 })
            remoteHeldSmoothRef.current.set(playerId, smooth)
          }
          smooth.setTarget(x, y)
        }
      }
      for (const id of remoteHeldSmoothRef.current.keys()) {
        if (!nextHeld.has(id)) remoteHeldSmoothRef.current.delete(id)
      }
      remoteCursorRef.current = nextCursors
      remoteHeldRef.current = nextHeld

      applyBoard(
        applyTickBoard(current, tick, geo.cols, geo.template, skipHeldIds()),
      )
    }

    const onClaimResult = (result: ClaimResult) => {
      const held = localDragRef.current
      if (!held || held.claimId !== result.clientClaimId) return
      if (!result.accepted || result.grantedPieceIndices.length === 0) {
        event('piece-logic', 'game.claim.denied_local', {
          'jigsaw.game.id': sessionId,
          clientClaimId: Number(result.clientClaimId),
          denied: result.deniedPieceIndices.length,
        })
        localDragRef.current = null
        dragSender.reset()
        setYieldNonce((n) => n + 1)
        return
      }
      held.claimed = true
    }

    const onMergeResult = (result: MergeResult) => {
      if (!result.accepted) {
        event('piece-logic', 'game.merge.denied_local', {
          'jigsaw.game.id': sessionId,
          clientMergeId: Number(result.clientMergeId),
          rejectReason: result.rejectReason || undefined,
        })
        setYieldNonce((n) => n + 1)
        return
      }
      // Prefer the merge board snapshot so a stale tick cannot un-join locally
      // before the server's next grouped delta arrives.
      if (result.board && builtRef.current) {
        applyBoard(
          boardJsonToPlacements(
            {
              boardRev: Number(result.board.boardRev),
              pieces: result.board.pieces.map((p) => ({
                pieceIndex: p.pieceIndex,
                xQ: p.xQ,
                yQ: p.yQ,
                groupId: p.groupId,
                rev: p.rev,
              })),
            },
            builtRef.current.cols,
            builtRef.current.template,
          ),
        )
      }
    }

    const onPresence = (presence: PresenceUpdate) => {
      applyPresenceRef.current(presence.players)
      for (const id of presence.removedPlayerIds) {
        remoteCursorRef.current.delete(id)
        remoteCursorSmoothRef.current.delete(id)
        remoteHeldRef.current.delete(id)
        remoteHeldSmoothRef.current.delete(id)
      }
    }

    const onGameEvent = (gameEvent: GameEvent) => {
      if (gameEvent.kind === GameEvent_Kind.FORCE_RELEASE) {
        event('piece-logic', 'game.force_release', {
          'jigsaw.game.id': sessionId,
        })
        localDragRef.current = null
        dragSender.reset()
        setYieldNonce((n) => n + 1)
      }
      if (gameEvent.board && builtRef.current) {
        applyBoard(
          boardJsonToPlacements(
            {
              boardRev: Number(gameEvent.board.boardRev),
              pieces: gameEvent.board.pieces.map((p) => ({
                pieceIndex: p.pieceIndex,
                xQ: p.xQ,
                yQ: p.yQ,
                groupId: p.groupId,
                rev: p.rev,
              })),
            },
            builtRef.current.cols,
            builtRef.current.template,
          ),
        )
      }
    }

    const session = new GameSyncSession(sessionId, player.id, {
      onWelcome,
      onTick,
      onClaimResult,
      onMergeResult,
      onPresence,
      onGameEvent,
      onHeartbeatAck: (rtt) => setRttMs(rtt),
      onClose: () => {
        if (closed) return
        setTransport(null)
      },
    })
    sessionRef.current = session

    void session
      .connect(play)
      .then(() => {
        if (closed) {
          session.close()
          return
        }
        const kind = session.transportKind
        setTransport(kind)
        event('networking', 'game.world.ready', {
          'jigsaw.game.id': sessionId,
          'jigsaw.player.id': player.id,
          transport: kind ?? 'none',
          boardPieces: board?.pieces.length ?? 0,
        })
      })
      .catch((err: unknown) => {
        if (closed) return
        const message = err instanceof Error ? err.message : String(err)
        event('networking', 'game.world.connect_failed', {
          'jigsaw.game.id': sessionId,
          'jigsaw.player.id': player.id,
          message,
        })
        setTransport(null)
      })

    const CURSOR_OTEL_MIN_MS = 50
    let lastLocalCursorOtelAt = 0
    const lastRemoteCursorOtelAt = new Map<string, number>()

    api.current = {
      reportPointer(x, y) {
        const now = performance.now()
        const packet = cursorSender.observe({ x, y, t: now })
        if (packet) {
          cursorShown = !packet.hide
          session.sendCursor(packet)
          if (now - lastLocalCursorOtelAt >= CURSOR_OTEL_MIN_MS) {
            lastLocalCursorOtelAt = now
            event('input', 'cursor.local', {
              'jigsaw.game.id': sessionId,
              'jigsaw.player.id': playerRef.current.id,
              x: Math.round(x * 10) / 10,
              y: Math.round(y * 10) / 10,
            })
          }
        }
        window.clearTimeout(stopTimer)
        stopTimer = window.setTimeout(() => {
          const anchor = cursorSender.flushAnchor()
          if (anchor) session.sendCursor(anchor)
        }, 70)
      },
      reportPointerGone() {
        window.clearTimeout(stopTimer)
        const packet = cursorSender.conceal()
        if (cursorShown || !packet.hide) session.sendCursor(packet)
        cursorShown = false
        event('input', 'cursor.local', {
          'jigsaw.game.id': sessionId,
          'jigsaw.player.id': playerRef.current.id,
          hide: true,
        })
      },
      reportDrag(placements, anchorId) {
        const geo = builtRef.current
        if (!geo) return
        const anchor = placements.find((piece) => piece.id === anchorId)
        if (!anchor) return
        const members = groupMembers(placements, anchor.group)
        const signature = `${anchorId}|${members.join(',')}`
        let held = localDragRef.current
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
            // Snap retags moving pieces onto the neighbor (target) group id.
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
              const mergeId = mergeCounter.current
              mergeCounter.current += 1n
              session.sendMerge({
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
              const resting = restingRef.current ?? []
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
                const mergeId = mergeCounter.current
                mergeCounter.current += 1n
                const neighborAnchor =
                  resting.find((piece) => piece.group === neighborGroup) ??
                  resting.find((piece) => piece.id === movingIds[0])
                session.sendMerge({
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
          const claimId = claimCounter.current
          claimCounter.current += 1n
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
          localDragRef.current = held
          session.sendClaim(indices, anchorIndex, claimId)
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
          // Always include members so observers keep a stable hold set even when
          // the server sparsifies pose.held_member_indices / holdings.
          session.sendMoveHeld({
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
          const current = localDragRef.current
          if (!current) return
          const anchorPacket = dragSender.flushAnchor()
          if (!anchorPacket) return
          const geoNow = builtRef.current
          if (!geoNow) return
          const a = pieceIndex(current.anchorId, geoNow.cols, geoNow.rows)
          const g = pieceIndex(current.group, geoNow.cols, geoNow.rows)
          if (a === null || g === null) return
          session.sendMoveHeld({
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
        const held = localDragRef.current
        const geo = builtRef.current
        const anchorPacket = dragSender.flushAnchor()
        if (held && anchorPacket && geo) {
          const a = pieceIndex(held.anchorId, geo.cols, geo.rows)
          const g = pieceIndex(held.group, geo.cols, geo.rows)
          if (a !== null && g !== null) {
            session.sendMoveHeld({
              anchorPieceIndex: a,
              groupId: g,
              members: held.members
                .map((id) => pieceIndex(id, geo.cols, geo.rows))
                .filter((v): v is number => v !== null),
              packet: anchorPacket,
            })
          }
        }
        if (held && geo) {
          const poses = placementsToFinalPoses(
            placements,
            geo.cols,
            geo.rows,
            held.members,
          )
          session.sendRelease(poses)
        }
        localDragRef.current = null
        dragSender.reset()
        window.clearTimeout(dragStopTimer)
        applyBoard(placements.map((p) => ({ ...p })))
      },
      reportDragCancel() {
        const held = localDragRef.current
        const geo = builtRef.current
        if (held && geo) {
          session.sendRelease([])
        }
        localDragRef.current = null
        dragSender.reset()
        window.clearTimeout(dragStopTimer)
      },
    }

    let lastPaintAt = performance.now()
    const paint = () => {
      if (closed) return
      const geo = builtRef.current
      const resting = restingRef.current
      if (!geo || !resting) return

      const now = performance.now()
      const dtSec = (now - lastPaintAt) / 1000
      lastPaintAt = now

      const nextCursors: RemoteCursor[] = []
      for (const [id, cursor] of remoteCursorRef.current) {
        if (cursor.hide) continue
        const smooth = remoteCursorSmoothRef.current.get(id)
        const pose = smooth?.step(dtSec, now) ?? { x: cursor.x, y: cursor.y }
        const lastOtel = lastRemoteCursorOtelAt.get(id) ?? 0
        if (now - lastOtel >= CURSOR_OTEL_MIN_MS) {
          lastRemoteCursorOtelAt.set(id, now)
          const delayed = smooth?.delayedTarget()
          event('input', 'cursor.remote', {
            'jigsaw.game.id': sessionId,
            remotePlayerId: id,
            x: Math.round(pose.x * 10) / 10,
            y: Math.round(pose.y * 10) / 10,
            // Delayed chase point (what we paint toward), not the newest tick.
            targetX: Math.round((delayed?.x ?? cursor.x) * 10) / 10,
            targetY: Math.round((delayed?.y ?? cursor.y) * 10) / 10,
          })
        }
        nextCursors.push({
          id,
          name: peerNamesRef.current.get(id) ?? fallbackNameRef.current,
          color: cursorColor(id),
          x: pose.x,
          y: pose.y,
        })
      }
      nextCursors.sort((a, b) => a.id.localeCompare(b.id))
      setCursors((prev) =>
        cursorsEqual(prev, nextCursors) ? prev : nextCursors,
      )

      let composed = resting.map((p) => ({ ...p }))
      const raised: string[] = []
      for (const [playerId, held] of [...remoteHeldRef.current.entries()].sort(
        (a, b) => (a[0] < b[0] ? 1 : -1),
      )) {
        raised.push(held.group)
        const anchor = composed.find((p) => p.id === held.anchorId)
        if (!anchor) continue
        const smooth = remoteHeldSmoothRef.current.get(playerId)
        const pose = smooth?.step(dtSec, now) ?? { x: held.x, y: held.y }
        const dx = pose.x - anchor.x
        const dy = pose.y - anchor.y
        const memberSet = new Set(held.members)
        composed = composed.map((piece) =>
          memberSet.has(piece.id)
            ? { ...piece, x: piece.x + dx, y: piece.y + dy }
            : piece,
        )
      }
      const local = localDragRef.current
      if (local?.claimed) raised.push(local.group)
      setRaisedGroups((prev) => (sameStrings(prev, raised) ? prev : raised))
      // Display only — resting board stays in restingRef.
      setView((prev) => (prev && boardsEqual(prev, composed) ? prev : composed))
    }

    const tick = () => {
      if (closed) return
      paint()
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)

    return () => {
      closed = true
      window.clearTimeout(stopTimer)
      window.clearTimeout(dragStopTimer)
      window.cancelAnimationFrame(frame)
      remoteHeldSmoothRef.current.clear()
      remoteCursorSmoothRef.current.clear()
      session.close()
      sessionRef.current = null
      setTransport(null)
      api.current = {
        reportPointer: () => {},
        reportPointerGone: () => {},
        reportDrag: () => {},
        reportDragEnd: () => {},
        reportDragCancel: () => {},
      }
    }
  }, [sessionId, player.id, play, board, built, joinGeneration, setTransport])

  const reportPointer = useCallback((x: number, y: number) => {
    api.current.reportPointer(x, y)
  }, [])
  const reportPointerGone = useCallback(() => {
    api.current.reportPointerGone()
  }, [])
  const reportDrag = useCallback(
    (placements: Placement[], anchorId: string) => {
      api.current.reportDrag(placements, anchorId)
    },
    [],
  )
  const reportDragEnd = useCallback((placements: Placement[]) => {
    api.current.reportDragEnd(placements)
  }, [])
  const reportDragCancel = useCallback(() => {
    api.current.reportDragCancel()
  }, [])

  return {
    placements: view,
    cursors,
    raisedGroups,
    masterId: null,
    yieldNonce,
    transport,
    rttMs,
    reportPointer,
    reportPointerGone,
    reportDrag,
    reportDragEnd,
    reportDragCancel,
  }
}

function cursorsEqual(
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

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}

function boardsEqual(
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
