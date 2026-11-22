/** Shared constants and pure helpers. See `dev/architecture.md`. */
export { createUlidLikeId, ULID_LIKE, ULID_LIKE_LENGTH } from './id.ts'
export {
  GAME_HTTP_BASE,
  GAME_WEBSOCKET_BASE,
  GAME_WEBTRANSPORT_BASE,
  HEARTBEAT_INTERVAL_MS,
  MEMBER_EVERY,
  WT_CONNECT_TIMEOUT_MS,
  resolvePlayUrl,
} from './config.ts'
export type { PuzzleSetup } from './puzzleSetup.ts'
export {
  isWebTransportEnabled,
  setWebTransportEnabled,
  subscribeWebTransportEnabled,
} from './transportPrefs.ts'
