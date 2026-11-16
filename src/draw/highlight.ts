export interface AxisBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Gamepad selection/hover ring in world coordinates (matches pad-group-hl layout). */
export function padGroupHighlightBox(
  bounds: AxisBounds,
  pad: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: bounds.minX - pad,
    top: bounds.minY - pad,
    width: bounds.maxX - bounds.minX + pad * 2,
    height: bounds.maxY - bounds.minY + pad * 2,
  }
}
