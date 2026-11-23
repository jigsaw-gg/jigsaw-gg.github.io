import type { Placement } from './placement.ts'

export interface RemoteCursor {
  id: string
  name: string
  color: string
  x: number
  y: number
}

export interface LocalDrag {
  anchorId: string
  group: string
  members: string[]
  signature: string
  sends: number
  claimId: bigint
  claimed: boolean
}

export interface RemoteHeld {
  anchorId: string
  group: string
  members: string[]
  /** Server held anchor minus cursor (world px); applied to painted cursor. */
  offsetX: number
  offsetY: number
}

/** One presentation clock per remote player (cursor smoother targets). */
export type RemotePresentationPhase =
  | { kind: 'holding' }
  | {
      kind: 'approaching_grab'
      anchorId: string
      members: string[]
      offsetX: number
      offsetY: number
      /** Grab offset from wire; false until cursor is near held (not re-entry). */
      offsetReady: boolean
    }
  | {
      kind: 'settling'
      anchorId: string
      members: string[]
      offsetX: number
      offsetY: number
    }
  | { kind: 'tracking' }

export interface BuiltGeometry {
  key: string
  cols: number
  rows: number
  cellW: number
  cellH: number
  template: Placement[]
}

export interface SyncApi {
  reportPointer: (x: number, y: number) => void
  reportPointerGone: () => void
  reportDrag: (placements: Placement[], anchorId: string) => void
  reportDragEnd: (placements: Placement[]) => void
  reportDragCancel: () => void
}

export type CursorTarget = { x: number; y: number; hide: boolean }
