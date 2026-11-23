/** Board, placements, motion, cursors (no React/canvas). See `dev/architecture.md`. */
export type {
  BuiltGeometry,
  CursorTarget,
  LocalDrag,
  RemoteCursor,
  RemoteHeld,
  RemotePresentationPhase,
  SyncApi,
} from './models.ts'
export {
  boardsEqual,
  composePaintFrame,
  cursorsEqual,
  sameStrings,
  type RemotePiecePoseOtel,
} from './paintState.ts'
export { createLocalInputApi } from './localInput.ts'
export { applyRemoteTickMaps } from './remoteFromTick.ts'
export { MousePathSmoother } from './mousePathSmoother.ts'
export {
  MotionSender,
  MOTION_Q,
  dequantize,
  quantize,
  type MotionPacket,
  type Sample,
} from './motion.ts'
export {
  scatterPieces,
  type Placement,
  type Camera,
  type Bounds,
  isPuzzleComplete,
  fitCamera,
  zoomCamera,
  moveGroup,
  clampGroup,
} from './placement.ts'
export {
  cursorColor,
  groupMembers,
  idFromIndex,
  pieceIndex,
  parsePieceId,
  overlayGroup,
  touchesPieces,
} from './groups.ts'
