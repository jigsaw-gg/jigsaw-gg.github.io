const MAX_DPR = 2

/** Device pixel ratio capped for piece-sized bitmaps. */
export function canvasDevicePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DPR)
}

/** Resize the backing store and apply a CSS-pixel transform for sharp drawing. */
export function layoutCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr = canvasDevicePixelRatio(),
): CanvasRenderingContext2D | null {
  const bitmapW = Math.max(1, Math.round(cssWidth * dpr))
  const bitmapH = Math.max(1, Math.round(cssHeight * dpr))
  if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
    canvas.width = bitmapW
    canvas.height = bitmapH
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/** Clear the drawable area in CSS pixel coordinates. */
export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight)
}
