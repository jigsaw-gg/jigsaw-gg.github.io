/** Lobby HTTP for ui — keeps ui off network. */
export {
  createGame,
  getGame,
  joinGame,
  leaveGame,
  GameHttpError,
  type BoardSnapshotJson,
  type CreateGameResult,
  type JoinGameResult,
  type PlayEndpoints,
} from '../network/gameClient.ts'
