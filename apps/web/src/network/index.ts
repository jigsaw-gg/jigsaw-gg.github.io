/** Raw client↔server transport and lobby HTTP. See `dev/architecture.md`. */
export {
  createGame,
  getGame,
  joinGame,
  leaveGame,
  GameHttpError,
  type BoardSnapshotJson,
  type CreateGameResult,
  type JoinGameResult,
  type PieceStateJson,
  type PlayEndpoints,
  type PlayerInfoJson,
} from './gameClient.ts'
export {
  asWritableBytes,
  encodeStreamFrame,
  payloadToBytes,
  StreamFrameReader,
} from './framing.ts'
export {
  dialPlayTransport,
  type PlayTransport,
  type PlayTransportHandlers,
  type PlayTransportKind,
} from './playTransport.ts'
export { GameSyncSession, type SyncHandlers } from './syncSession.ts'
