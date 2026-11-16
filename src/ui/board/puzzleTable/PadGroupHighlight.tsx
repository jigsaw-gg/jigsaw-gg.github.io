import { padGroupHighlightBox } from '../../../draw/index.ts'
import { groupWorldBounds } from '../../../input/gamepadView.ts'
import type { Placement } from '../../../world/placement.ts'

export function PadGroupHighlight({
  placements,
  group,
  cellW,
  cellH,
  pad,
  mode,
}: {
  placements: readonly Placement[]
  group: string
  cellW: number
  cellH: number
  pad: number
  mode: 'selected' | 'hover'
}) {
  const bounds = groupWorldBounds(placements, group, cellW, cellH)
  if (!bounds) return null
  const box = padGroupHighlightBox(bounds, pad)
  return (
    <div
      className={
        mode === 'selected'
          ? 'pad-group-hl pad-group-hl--selected'
          : 'pad-group-hl pad-group-hl--hover'
      }
      aria-hidden="true"
      style={box}
    />
  )
}
