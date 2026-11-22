/** SVG viewBox 0 0 18 18 — shared by DOM and canvas painting. */
export const REMOTE_POINTER_ARROW_PATH =
  'M1 1 L1 14.2 L4.7 10.6 L8.4 16.2 L10.6 15 L6.9 9.4 L11.6 9 Z'

export const REMOTE_POINTER_VIEW_SIZE = 18

export function drawRemotePointerArrow(
  ctx: CanvasRenderingContext2D,
  fillStyle: string,
): void {
  const path = new Path2D(REMOTE_POINTER_ARROW_PATH)
  ctx.fillStyle = fillStyle
  ctx.fill(path)
  ctx.strokeStyle = '#fff'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1
  ctx.stroke(path)
}
