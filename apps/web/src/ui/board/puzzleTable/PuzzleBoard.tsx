import type { PuzzleSetup } from '../../../play/session.ts'
import type { RemoteCursor } from '../../../play/useGameWorld.ts'
import type { Placement } from '../../../world/placement.ts'
import { PuzzleTable } from './PuzzleTable.tsx'

export function PuzzleBoard({
  setup,
  active,
  placements,
  cursors,
  raisedGroups,
  yieldNonce,
  onLeave,
  onPointer,
  onPointerGone,
  onDrag,
  onDragEnd,
  onDragCancel,
}: {
  setup: PuzzleSetup
  active: boolean
  placements: Placement[]
  cursors: readonly RemoteCursor[]
  raisedGroups: readonly string[]
  yieldNonce: number
  onLeave: () => void
  onPointer: (x: number, y: number) => void
  onPointerGone: () => void
  onDrag: (placements: Placement[], anchorId: string) => void
  onDragEnd: (placements: Placement[]) => void
  onDragCancel: () => void
}) {
  return (
    <PuzzleTable
      key={`${setup.seed}:${setup.pieceCount}:${setup.imageWidth}:${setup.imageHeight}`}
      setup={setup}
      active={active}
      placements={placements}
      cursors={cursors}
      raisedGroups={raisedGroups}
      yieldNonce={yieldNonce}
      onLeave={onLeave}
      onPointer={onPointer}
      onPointerGone={onPointerGone}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    />
  )
}
