import { withSpan } from '../otel/index.ts'
import type { PuzzleSetup } from '../puzzle/session.ts'
import {
  GAME_HTTP_BASE,
  GAME_WEBSOCKET_BASE,
  GAME_WEBTRANSPORT_BASE,
  resolvePlayUrl,
} from './config.ts'

export class GameHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'GameHttpError'
    this.status = status
    this.code = code
  }
}

/** Absolute dial URLs after resolving JoinGame paths against client bases. */
export interface PlayEndpoints {
  webtransportUrl: string
  websocketUrl: string
}

/** Wire shape from JoinGame (path-only preferred; legacy absolute still accepted). */
type RawPlayEndpoints = {
  webtransportPath?: string
  websocketPath?: string
  /** @deprecated absolute URL; host/port ignored — path+query kept */
  webtransportUrl?: string
  /** @deprecated absolute URL; host/port ignored — path+query kept */
  websocketUrl?: string
}

function resolvePlayEndpoints(
  raw: RawPlayEndpoints | undefined,
): PlayEndpoints {
  const wtPath = raw?.webtransportPath ?? raw?.webtransportUrl ?? ''
  const wsPath = raw?.websocketPath ?? raw?.websocketUrl ?? ''
  const websocketUrl = resolvePlayUrl(GAME_WEBSOCKET_BASE, wsPath)
  if (!websocketUrl) {
    throw new GameHttpError(
      502,
      'bad_response',
      'Join response missing play websocket path',
    )
  }
  return {
    webtransportUrl: resolvePlayUrl(GAME_WEBTRANSPORT_BASE, wtPath),
    websocketUrl,
  }
}

export interface PieceStateJson {
  pieceIndex: number
  xQ: number
  yQ: number
  groupId: number
  rev: number
  /** Clockwise quarter turns, 0..3. Absent means upright. */
  rotation?: number
}

export interface BoardSnapshotJson {
  boardRev: string | number
  pieces: PieceStateJson[]
}

export interface PlayerInfoJson {
  playerId: string
  displayName: string
  online: boolean
}

export interface CreateGameResult {
  gameId: string
  setup: PuzzleSetup
  cols: number
  rows: number
  expiresAtMs: number
}

export interface JoinGameResult {
  gameId: string
  playerId: string
  setup: PuzzleSetup
  cols: number
  rows: number
  expiresAtMs: number
  board: BoardSnapshotJson | null
  players: PlayerInfoJson[]
  play: PlayEndpoints
  negotiatedTransport: number
}

interface SetupJson {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  pieceCount: number
  seed: number
  rotationEnabled?: boolean
}

function toSetup(raw: SetupJson | undefined): PuzzleSetup {
  if (!raw || typeof raw.imageUrl !== 'string' || !raw.imageUrl.trim()) {
    throw new GameHttpError(502, 'bad_response', 'Missing puzzle setup')
  }
  return {
    imageUrl: raw.imageUrl,
    imageWidth: Number(raw.imageWidth),
    imageHeight: Number(raw.imageHeight),
    pieceCount: Number(raw.pieceCount),
    seed: Number(raw.seed) >>> 0,
    // A server without rotation drops the field: the game is not rotating.
    rotationEnabled: raw.rotationEnabled === true,
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${GAME_HTTP_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      parsed = null
    }
  }
  if (!response.ok) {
    const err = parsed as { code?: string; message?: string } | null
    throw new GameHttpError(
      response.status,
      err?.code ?? 'http_error',
      err?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed as T
}

export async function createGame(input: {
  gameId: string
  creatorPlayerId: string
  creatorDisplayName: string
  setup: PuzzleSetup
}): Promise<CreateGameResult> {
  return withSpan(
    'networking',
    'game.create',
    async (span) => {
      span.setAttributes({
        'jigsaw.game.id': input.gameId,
        'jigsaw.player.id': input.creatorPlayerId,
        pieceCount: input.setup.pieceCount,
        seed: input.setup.seed,
        rotationEnabled: input.setup.rotationEnabled,
      })
      const raw = await postJson<{
        gameId: string
        setup?: SetupJson
        cols: number
        rows: number
        expiresAtMs: number | string
      }>('/v1/game/create', {
        gameId: input.gameId,
        creatorPlayerId: input.creatorPlayerId,
        creatorDisplayName: input.creatorDisplayName,
        setup: {
          imageUrl: input.setup.imageUrl,
          imageWidth: input.setup.imageWidth,
          imageHeight: input.setup.imageHeight,
          pieceCount: input.setup.pieceCount,
          seed: input.setup.seed,
          rotationEnabled: input.setup.rotationEnabled,
        },
      })
      const result = {
        gameId: raw.gameId,
        setup: toSetup(raw.setup),
        cols: Number(raw.cols),
        rows: Number(raw.rows),
        expiresAtMs: Number(raw.expiresAtMs),
      }
      span.setAttributes({ cols: result.cols, rows: result.rows })
      return result
    },
    { 'jigsaw.game.id': input.gameId },
  )
}

export async function joinGame(input: {
  gameId: string
  playerId: string
  displayName: string
  preferredTransport?: number
}): Promise<JoinGameResult> {
  return withSpan(
    'networking',
    'game.join',
    async (span) => {
      span.setAttributes({
        'jigsaw.game.id': input.gameId,
        'jigsaw.player.id': input.playerId,
      })
      const raw = await postJson<{
        gameId: string
        playerId: string
        setup?: SetupJson
        cols: number
        rows: number
        expiresAtMs: number | string
        board?: BoardSnapshotJson
        players?: PlayerInfoJson[]
        play?: RawPlayEndpoints
        negotiatedTransport?: number
      }>('/v1/game/join', {
        gameId: input.gameId,
        playerId: input.playerId,
        displayName: input.displayName,
        // TRANSPORT_PREFERENCE_AUTO
        preferredTransport: input.preferredTransport ?? 3,
      })
      const play = resolvePlayEndpoints(raw.play)
      const result: JoinGameResult = {
        gameId: raw.gameId,
        playerId: raw.playerId,
        setup: toSetup(raw.setup),
        cols: Number(raw.cols),
        rows: Number(raw.rows),
        expiresAtMs: Number(raw.expiresAtMs),
        board: raw.board ?? null,
        players: raw.players ?? [],
        play,
        negotiatedTransport: Number(raw.negotiatedTransport ?? 0),
      }
      span.setAttributes({
        cols: result.cols,
        rows: result.rows,
        boardPieces: result.board?.pieces.length ?? 0,
        playerCount: result.players.length,
        negotiatedTransport: result.negotiatedTransport,
        hasWebTransport: Boolean(result.play.webtransportUrl),
        wtBase: GAME_WEBTRANSPORT_BASE,
        wsBase: GAME_WEBSOCKET_BASE,
      })
      return result
    },
    { 'jigsaw.game.id': input.gameId, 'jigsaw.player.id': input.playerId },
  )
}

export async function leaveGame(
  gameId: string,
  playerId: string,
): Promise<void> {
  await withSpan(
    'networking',
    'game.leave',
    async () => {
      try {
        await postJson('/v1/game/leave', { gameId, playerId })
      } catch {
        // Best-effort on unload / unmount.
      }
    },
    { 'jigsaw.game.id': gameId, 'jigsaw.player.id': playerId },
  )
}

export async function getGame(gameId: string): Promise<{
  setup: PuzzleSetup
  expired: boolean
  cols: number
  rows: number
} | null> {
  return withSpan(
    'networking',
    'game.get',
    async (span) => {
      try {
        const raw = await postJson<{
          setup?: SetupJson
          expired?: boolean
          cols: number
          rows: number
        }>('/v1/game/get', { gameId })
        const result = {
          setup: toSetup(raw.setup),
          expired: Boolean(raw.expired),
          cols: Number(raw.cols),
          rows: Number(raw.rows),
        }
        span.setAttributes({
          expired: result.expired,
          cols: result.cols,
          rows: result.rows,
        })
        return result
      } catch (err) {
        if (
          err instanceof GameHttpError &&
          (err.status === 404 || err.code === 'not_found')
        ) {
          span.setAttribute('found', false)
          return null
        }
        throw err
      }
    },
    { 'jigsaw.game.id': gameId },
  )
}
