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
} from '../network/gen/game_pb.ts'
import { event, setPlayTransport } from '../otel/index.ts'
import { buildPuzzle } from '../jigsaw/cut.ts'
import { scatterPieces, type Placement } from '../world/placement.ts'
import type { PuzzleSetup } from './session.ts'
import {
  applyTickBoard,
  boardJsonToPlacements,
  placementsToFinalPoses,
} from './applyTick.ts'
import type { BoardSnapshotJson, PlayEndpoints } from '../network/gameClient.ts'
import { MousePathSmoother } from '../world/mousePathSmoother.ts'
import { packetToSample, sampleToPacket } from './motionCodec.ts'
import { GameSyncSession } from '../network/syncSession.ts'

import type { LocalDrag, RemoteCursor, SyncApi } from '../world/models.ts'
import { createLocalInputApi } from '../world/localInput.ts'
import { applyRemoteTickMaps } from '../world/remoteFromTick.ts'
import {
  boardsEqual,
  composePaintFrame,
  cursorsEqual,
  sameStrings,
} from '../world/paintState.ts'

export type { RemoteCursor }

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
  fallbackPlayerName: string,
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

  const restingRef = useRef<Placement[] | null>(null)
  const builtRef = useRef(built)
  const playerRef = useRef(player)
  const peerNamesRef = useRef(peerNames)
  const fallbackNameRef = useRef(fallbackPlayerName)
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
    fallbackNameRef.current = fallbackPlayerName
    applyPresenceRef.current = applyPresence
  }, [built, player, peerNames, fallbackPlayerName, applyPresence])

  useEffect(() => {
    if (!built || !play || joinGeneration < 1) return

    remoteHeldSmoothRef.current.clear()
    remoteCursorSmoothRef.current.clear()

    const initial =
      board && board.pieces.length > 0
        ? boardJsonToPlacements(board, built.cols, built.template)
        : built.template.map((piece) => ({ ...piece }))
    restingRef.current = initial

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

    let resetDragSender = () => {}

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

      const { nextCursors, nextHeld } = applyRemoteTickMaps({
        localPlayerId: playerRef.current.id,
        cols: geo.cols,
        rows: geo.rows,
        players: tick.players.map((pose) => ({
          playerId: pose.playerId,
          cursor: pose.cursor ? sampleToPacket(pose.cursor) : null,
          held: pose.held ? sampleToPacket(pose.held) : null,
          heldMemberIndices: pose.heldMemberIndices,
          heldAnchorPieceIndex: pose.heldAnchorPieceIndex,
          heldGroupId: pose.heldGroupId,
        })),
        holdings: tick.holdings.map((h) => ({
          playerId: h.playerId,
          memberPieceIndices: h.memberPieceIndices,
          anchorPieceIndex: h.anchorPieceIndex,
          groupId: h.groupId,
        })),
        prevCursors: remoteCursorRef.current,
        prevHeld: remoteHeldRef.current,
        cursorSmooth: remoteCursorSmoothRef.current,
        heldSmooth: remoteHeldSmoothRef.current,
      })
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
        resetDragSender()
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
        resetDragSender()
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

    const lastRemoteCursorOtelAt = new Map<string, number>()
    const CURSOR_OTEL_MIN_MS = 50

    const input = createLocalInputApi(
      sessionId,
      {
        sendCursor: (packet) => session.sendCursor(packetToSample(packet)),
        sendClaim: (indices, anchor, claimId) =>
          session.sendClaim(indices, anchor, claimId),
        sendMerge: (input) => session.sendMerge(input),
        sendMoveHeld: (input) =>
          session.sendMoveHeld({
            anchorPieceIndex: input.anchorPieceIndex,
            groupId: input.groupId,
            members: input.members,
            motion: packetToSample(input.packet),
          }),
        sendRelease: (placements, memberIds) => {
          const geo = builtRef.current
          if (!geo) return
          session.sendRelease(
            placementsToFinalPoses(placements, geo.cols, geo.rows, memberIds),
          )
        },
        sendReleaseEmpty: () => session.sendRelease([]),
      },
      {
        built: () => builtRef.current,
        resting: () => restingRef.current,
        localDrag: {
          get: () => localDragRef.current,
          set: (value) => {
            localDragRef.current = value
          },
        },
        playerId: () => playerRef.current.id,
        applyBoard,
      },
      { claim: claimCounter, merge: mergeCounter },
    )
    resetDragSender = input.resetDragSender
    api.current = input.api

    let lastPaintAt = performance.now()
    const paint = () => {
      if (closed) return
      const geo = builtRef.current
      const resting = restingRef.current
      if (!geo || !resting) return

      const now = performance.now()
      const dtSec = (now - lastPaintAt) / 1000
      lastPaintAt = now

      const local = localDragRef.current
      const frame = composePaintFrame({
        resting,
        remoteCursors: remoteCursorRef.current,
        remoteCursorSmooth: remoteCursorSmoothRef.current,
        remoteHeld: remoteHeldRef.current,
        remoteHeldSmooth: remoteHeldSmoothRef.current,
        localClaimedGroup: local?.claimed ? local.group : null,
        peerNames: peerNamesRef.current,
        fallbackName: fallbackNameRef.current,
        dtSec,
        now,
      })

      for (const pose of frame.remoteCursorPoses) {
        const lastOtel = lastRemoteCursorOtelAt.get(pose.id) ?? 0
        if (now - lastOtel >= CURSOR_OTEL_MIN_MS) {
          lastRemoteCursorOtelAt.set(pose.id, now)
          event('input', 'cursor.remote', {
            'jigsaw.game.id': sessionId,
            remotePlayerId: pose.id,
            x: Math.round(pose.x * 10) / 10,
            y: Math.round(pose.y * 10) / 10,
            targetX: Math.round(pose.targetX * 10) / 10,
            targetY: Math.round(pose.targetY * 10) / 10,
          })
        }
      }

      setCursors((prev) =>
        cursorsEqual(prev, frame.cursors) ? prev : frame.cursors,
      )
      setRaisedGroups((prev) =>
        sameStrings(prev, frame.raisedGroups) ? prev : frame.raisedGroups,
      )
      setView((prev) =>
        prev && boardsEqual(prev, frame.placements) ? prev : frame.placements,
      )
    }

    const tick = () => {
      if (closed) return
      paint()
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)

    return () => {
      closed = true
      input.dispose()
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
