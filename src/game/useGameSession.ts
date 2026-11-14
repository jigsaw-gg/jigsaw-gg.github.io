import { useCallback, useEffect, useMemo, useState } from 'react'
import { i18nError } from '../i18n/errors.ts'
import { event } from '../otel/index.ts'
import { writeSession, type PuzzleSetup } from '../puzzle/session.ts'
import {
  SESSION_STORAGE_PREFIX,
  WORLD_STORAGE_PREFIX,
} from '../puzzle/storageTtl.ts'
import { isWebTransportEnabled } from '../transportPrefs.ts'
import {
  GameHttpError,
  joinGame,
  leaveGame,
  type BoardSnapshotJson,
  type PlayEndpoints,
} from './gameClient.ts'

export type SessionPhase = 'connecting' | 'live' | 'error' | 'expired'

export interface SessionPlayer {
  id: string
  name: string
  self: boolean
}

export interface GameSessionState {
  setup: PuzzleSetup | null
  phase: SessionPhase
  channelError: string | null
  channelName: string
  source: 'cache' | 'server' | null
  players: SessionPlayer[]
  cols: number | null
  rows: number | null
  board: BoardSnapshotJson | null
  play: PlayEndpoints | null
  joinGeneration: number
  applyPresence: (
    players: { playerId: string; displayName: string; online: boolean }[],
  ) => void
}

function clearLocalGameCaches(sessionId: string): void {
  try {
    localStorage.removeItem(`${SESSION_STORAGE_PREFIX}${sessionId}`)
    const prefix = `${WORLD_STORAGE_PREFIX}${sessionId}:`
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function useGameSession(
  sessionId: string,
  player: { id: string; name: string },
): GameSessionState {
  const [setup, setSetup] = useState<PuzzleSetup | null>(null)
  const [phase, setPhase] = useState<SessionPhase>('connecting')
  const [channelError, setChannelError] = useState<string | null>(null)
  const [source, setSource] = useState<'cache' | 'server' | null>(null)
  const [peers, setPeers] = useState<{ id: string; name: string }[]>([])
  const [cols, setCols] = useState<number | null>(null)
  const [rows, setRows] = useState<number | null>(null)
  const [board, setBoard] = useState<BoardSnapshotJson | null>(null)
  const [play, setPlay] = useState<PlayEndpoints | null>(null)
  const [joinGeneration, setJoinGeneration] = useState(0)

  const applyPresence = useCallback(
    (list: { playerId: string; displayName: string; online: boolean }[]) => {
      setPeers(
        list
          .filter((p) => p.playerId !== player.id && p.online)
          .map((p) => ({ id: p.playerId, name: p.displayName }))
          .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          ),
      )
    },
    [player.id],
  )

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setPhase('connecting')
      setChannelError(null)
      try {
        const result = await joinGame({
          gameId: sessionId,
          playerId: player.id,
          displayName: player.name,
          // TRANSPORT_PREFERENCE_WEBSOCKET=2, AUTO=3
          preferredTransport: isWebTransportEnabled() ? 3 : 2,
        })
        if (cancelled) return
        writeSession(sessionId, result.setup)
        setSetup(result.setup)
        setSource('server')
        setCols(result.cols)
        setRows(result.rows)
        setBoard(result.board)
        setPlay(result.play)
        applyPresence(result.players)
        setPhase('live')
        setJoinGeneration((n) => n + 1)
        event('networking', 'game.session.live', {
          'jigsaw.game.id': sessionId,
          'jigsaw.player.id': player.id,
          cols: result.cols,
          rows: result.rows,
          boardPieces: result.board?.pieces.length ?? 0,
          playerCount: result.players.length,
        })
      } catch (err) {
        if (cancelled) return
        if (err instanceof GameHttpError) {
          if (
            err.status === 404 ||
            err.code === 'not_found' ||
            /expir/i.test(err.message) ||
            /not found/i.test(err.message)
          ) {
            clearLocalGameCaches(sessionId)
            setPhase('expired')
            setChannelError(err.message || i18nError('channelJoin'))
            setSetup(null)
            event('networking', 'game.session.expired', {
              'jigsaw.game.id': sessionId,
              status: err.status,
              code: err.code,
            })
            return
          }
          setPhase('error')
          setChannelError(err.message || i18nError('channelJoin'))
          event('networking', 'game.session.error', {
            'jigsaw.game.id': sessionId,
            status: err.status,
            code: err.code,
            message: err.message,
          })
          return
        }
        setPhase('error')
        const message =
          err instanceof Error ? err.message : i18nError('connection')
        setChannelError(message)
        event('networking', 'game.session.error', {
          'jigsaw.game.id': sessionId,
          message,
        })
      }
    })()

    return () => {
      cancelled = true
      void leaveGame(sessionId, player.id)
    }
  }, [sessionId, player.id, player.name, applyPresence])

  const players = useMemo<SessionPlayer[]>(
    () => [
      { id: player.id, name: player.name, self: true },
      ...peers.map((peer) => ({ ...peer, self: false })),
    ],
    [player.id, player.name, peers],
  )

  return {
    setup,
    phase,
    channelError,
    channelName: `game:${sessionId}`,
    source,
    players,
    cols,
    rows,
    board,
    play,
    joinGeneration,
    applyPresence,
  }
}
