/** Session composition and proto↔world codecs. See `dev/architecture.md`. */
export { useGameWorld } from './useGameWorld.ts'
export type { RemoteCursor } from './useGameWorld.ts'
export { useGameSession } from './useGameSession.ts'
export type {
  GameSessionState,
  SessionPhase,
  SessionPlayer,
} from './useGameSession.ts'
export { packetToSample, sampleToPacket } from './motionCodec.ts'
export {
  applyTickBoard,
  boardJsonToPlacements,
  placementsToFinalPoses,
} from './applyTick.ts'
export {
  createSessionId,
  normalizeSessionId,
  playInvitePath,
  writeSession,
  type PuzzleSetup,
} from './session.ts'
export { purgeExpiredPuzzleStorage } from './storageTtl.ts'
export {
  createGame,
  getGame,
  joinGame,
  leaveGame,
  GameHttpError,
} from './lobby.ts'
export { playError } from './errorCodes.ts'
