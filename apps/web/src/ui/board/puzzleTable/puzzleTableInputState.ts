import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from 'react'
import type { PadDirection } from '../../../input/gamepadView.ts'
import type { EdgePull } from './edgeCruise.ts'
import type { Camera, NearPair, Placement } from '../../../world/placement.ts'
import type { HandoverView, ThumbStickView } from './boardChrome.tsx'
import type {
  ActiveCruise,
  Drag,
  Pan,
  SlideOffset,
} from './puzzleTableShared.ts'
import type { scatterPieces } from '../../../world/placement.ts'
import { playArea } from '../../../world/placement.ts'

export type PuzzleTableLayout = ReturnType<typeof scatterPieces>
export type PuzzleTableArea = ReturnType<typeof playArea>

export type PuzzleTableInputState = {
  active: boolean
  layout: PuzzleTableLayout
  area: PuzzleTableArea
  viewportRef: RefObject<HTMLDivElement | null>
  placementsRef: MutableRefObject<Placement[]>
  viewRef: MutableRefObject<Camera>
  followRef: MutableRefObject<Camera>
  dragRef: MutableRefObject<Drag | null>
  padGroupRef: MutableRefObject<string | null>
  padHoverRef: MutableRefObject<string | null>
  padHoverIdRef: MutableRefObject<string | null>
  padPointerRef: MutableRefObject<{ x: number; y: number } | null>
  selectionRef: MutableRefObject<string | null>
  interestRef: MutableRefObject<{ x: number; y: number }>
  boardLockedRef: MutableRefObject<boolean>
  pinchActiveRef: MutableRefObject<boolean>
  panRef: MutableRefObject<Pan | null>
  userAdjustedRef: MutableRefObject<boolean>
  offsetsRef: MutableRefObject<Map<string, SlideOffset>>
  slideFrameRef: MutableRefObject<number>
  handoverTimerRef: MutableRefObject<number>
  handoverRef: MutableRefObject<HandoverView | null>
  cruiseStickRef: MutableRefObject<ThumbStickView | null>
  stickFrameRef: MutableRefObject<number>
  stickTickRef: MutableRefObject<(now: number) => void>
  cruiseRef: MutableRefObject<ActiveCruise | null>
  cruiseFrameRef: MutableRefObject<number>
  cruiseTickRef: MutableRefObject<(now: number) => void>
  padClockRef: MutableRefObject<{
    last: number
    l1: boolean
    r1: boolean
    triangle: boolean
    up: boolean
    down: boolean
    leftPad: boolean
    rightPad: boolean
    idle: number
    showUntil: number
    latched: boolean
  }>
  blinkRef: MutableRefObject<boolean>
  connectedRef: MutableRefObject<boolean>
  helpOpenRef: MutableRefObject<boolean>
  setView: Dispatch<SetStateAction<Camera>>
  setOffsets: Dispatch<SetStateAction<ReadonlyMap<string, SlideOffset>>>
  setPlacements: Dispatch<SetStateAction<Placement[]>>
  setFrontGroup: Dispatch<SetStateAction<string | null>>
  setDragGroup: Dispatch<SetStateAction<string | null>>
  setNear: Dispatch<SetStateAction<NearPair | null>>
  setPulses: Dispatch<SetStateAction<ReadonlyMap<string, number>>>
  setHandover: Dispatch<SetStateAction<HandoverView | null>>
  setCruiseStick: Dispatch<SetStateAction<ThumbStickView | null>>
  setPanStick: Dispatch<SetStateAction<ThumbStickView | null>>
  setPanning: Dispatch<SetStateAction<boolean>>
  setPadGroup: Dispatch<SetStateAction<string | null>>
  setPadHoverGroup: Dispatch<SetStateAction<string | null>>
  setPadPointer: Dispatch<SetStateAction<{ x: number; y: number } | null>>
  setGamepadConnected: Dispatch<SetStateAction<boolean>>
  setGamepadBlink: Dispatch<SetStateAction<boolean>>
  setGamepadHelpOpen: Dispatch<SetStateAction<boolean>>
  onPointer: (x: number, y: number) => void
  onDrag: (placements: Placement[], anchorId: string) => void
  onDragEnd: (placements: Placement[]) => void
  onDragCancel: () => void
}

export type PuzzleTableActions = {
  present: (follow: Camera) => Camera
  commitView: (next: Camera) => void
  playPoint: (event: { clientX: number; clientY: number }) => {
    x: number
    y: number
    scale: number
  } | null
  publishPointer: (clientX: number, clientY: number) => void
  finishDrag: (commit: boolean) => void
  rememberMembers: (drag: Drag) => void
  beginSlide: () => void
  launchSnap: (before: Placement[], after: Placement[]) => void
  pulseGroup: (group: string) => void
  twoThumbNow: (rect: DOMRect | null) => boolean
  clearHandover: () => void
  syncHandover: (drag: Drag) => void
  showCruiseStick: (next: ThumbStickView | null) => void
  cruiseStickView: (
    drag: Drag,
    rect: DOMRect,
    pull: EdgePull,
  ) => ThumbStickView | null
  publishPanStick: () => void
  pokeStickPan: () => void
  stickPanTick: (now: number) => void
  lockHeldPiece: (next: Camera, drag: Drag, viewport: HTMLDivElement) => Camera
  endPan: (event: React.PointerEvent<HTMLDivElement>) => void
  stopPan: () => void
  onViewportPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onViewportPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  onViewportPointerMoveCapture: (
    event: React.PointerEvent<HTMLDivElement>,
  ) => void
  onPointerDown: (
    event: React.PointerEvent<HTMLCanvasElement>,
    id: string,
  ) => void
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void
  moveDragTo: (clientX: number, clientY: number) => boolean
  moveDragToWorld: (rawX: number, rawY: number, scale: number) => boolean
  viewportSize: () => { width: number; height: number } | null
  cameraForViewport: (
    width: number,
    height: number,
  ) => ReturnType<typeof import('../../../world/placement.ts').cameraLimits>
  revealGroup: (group: string) => void
  clearPadSelection: () => void
  selectHoveredPad: (id: string) => void
  syncPadPointer: (
    next: { x: number; y: number } | null,
    hover: string | null,
    hoverId?: string | null,
  ) => void
  hoverJump: (
    direction: PadDirection,
    size: { width: number; height: number },
  ) => void
  beginGamepadDrag: (id: string) => boolean
  moveDragBy: (dx: number, dy: number) => { dx: number; dy: number } | null
  gamepadTick: (now: number) => void
  beginCruise: (clientX: number, clientY: number) => void
  pokeCruise: () => void
  cruiseTick: (now: number) => void
  easeCruiseZoom: (
    cruise: ActiveCruise,
    current: Camera,
    viewport: HTMLDivElement,
    dt: number,
  ) => boolean
}
