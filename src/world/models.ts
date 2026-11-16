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
  /** Last tick target; display pose comes from the smoother. */
  x: number
  y: number
}

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
