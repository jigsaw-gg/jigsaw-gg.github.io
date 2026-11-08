import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPuzzle, type PieceModel, type Point } from '../puzzle/cut.ts'
import {
  approachLimits,
  cameraLimits,
  clampGroup,
  fitCamera,
  moveGroup,
  pieceBounds,
  playArea,
  pullToNeighbors,
  scatterPieces,
  zoomCamera,
  type Camera,
  type NearPair,
  type Placement,
  type ScatteredBoard,
} from '../puzzle/play.ts'
import type { PuzzleSetup } from '../puzzle/session.ts'

/** Nearby-piece glow fade, in milliseconds. */
const GLOW_MS = 260
/**
 * Critically damped snap, in rad/s. The piece speeds up toward the join,
 * then settles on it.
 */
const SNAP_RESPONSE = 22

interface SlideOffset {
  x: number
  y: number
  vx: number
  vy: number
}

function allowsMotion(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function settleSlide(body: SlideOffset, dt: number): void {
  const response = SNAP_RESPONSE
  const decay = Math.exp(-response * dt)
  const carryX = body.vx + response * body.x
  const carryY = body.vy + response * body.y
  body.x = (body.x + carryX * dt) * decay
  body.y = (body.y + carryY * dt) * decay
  body.vx = (body.vx - response * carryX * dt) * decay
  body.vy = (body.vy - response * carryY * dt) * decay
}

function slideResting(body: SlideOffset): boolean {
  return Math.hypot(body.x, body.y) < 0.2 && Math.hypot(body.vx, body.vy) < 4
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function useFade(active: boolean): number {
  const motion = allowsMotion()
  const [value, setValue] = useState(active ? 1 : 0)
  const valueRef = useRef(value)

  useEffect(() => {
    const to = active ? 1 : 0
    const from = valueRef.current
    if (Math.abs(from - to) < 0.001) return
    if (!motion) {
      const frame = requestAnimationFrame(() => {
        valueRef.current = to
        setValue(to)
      })
      return () => cancelAnimationFrame(frame)
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / GLOW_MS)
      const next = from + (to - from) * easeInOut(t)
      valueRef.current = next
      setValue(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, motion])

  return value
}

export function PuzzleBoard({
  setup,
  active,
  onLeave,
}: {
  setup: PuzzleSetup
  active: boolean
  onLeave: () => void
}) {
  return (
    <PuzzleTable
      key={`${setup.seed}:${setup.pieceCount}:${setup.imageWidth}:${setup.imageHeight}`}
      setup={setup}
      active={active}
      onLeave={onLeave}
    />
  )
}

function PuzzleTable({
  setup,
  active,
  onLeave,
}: {
  setup: PuzzleSetup
  active: boolean
  onLeave: () => void
}) {
  const model = useMemo(() => buildPuzzle(setup), [setup])
  const layout = useMemo(
    () => scatterPieces(model, setup.seed),
    [model, setup.seed],
  )
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [placements, setPlacements] = useState(layout.placements)
  const [near, setNear] = useState<NearPair | null>(null)
  const [frontGroup, setFrontGroup] = useState<string | null>(null)
  const [dragGroup, setDragGroup] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const offsetsRef = useRef(new Map<string, SlideOffset>())
  const slideFrameRef = useRef(0)
  const [offsets, setOffsets] = useState<ReadonlyMap<string, SlideOffset>>(
    () => new Map(),
  )
  const area = useMemo(
    () => playArea(layout.playW, layout.playH),
    [layout.playW, layout.playH],
  )
  const opening = useMemo(
    () =>
      pieceBounds(layout.placements, layout.cellW, layout.cellH, layout.pad),
    [layout],
  )
  const [view, setView] = useState<Camera>(() =>
    fitCamera(window.innerWidth, window.innerHeight, opening, 0),
  )
  const placementsRef = useRef(layout.placements)
  const viewRef = useRef(view)
  const dragRef = useRef<Drag | null>(null)
  const panRef = useRef<Pan | null>(null)
  const userAdjustedRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) {
        setImage(img)
        setFailed(false)
      }
    }
    img.onerror = () => {
      if (!cancelled) {
        setImage(null)
        setFailed(true)
      }
    }
    img.src = setup.imageUrl
    return () => {
      cancelled = true
    }
  }, [setup.imageUrl])

  useEffect(() => {
    return () => cancelAnimationFrame(slideFrameRef.current)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const fit = () => {
      if (userAdjustedRef.current) return
      const rect = viewport.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const next = fitCamera(rect.width, rect.height, opening, 0)
      viewRef.current = next
      setView(next)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [opening])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      const current = viewRef.current
      if (!current) return
      event.preventDefault()
      let delta = event.deltaY
      if (event.deltaMode === 1) delta *= 16
      if (event.deltaMode === 2) delta *= viewport.clientHeight
      const rect = viewport.getBoundingClientRect()
      const limits = cameraLimits(
        rect.width,
        rect.height,
        area,
        Math.min(layout.cellW, layout.cellH),
      )
      const next = zoomCamera(
        current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-delta * 0.0016),
        limits.min,
        limits.max,
      )
      userAdjustedRef.current = true
      viewRef.current = next
      setView(next)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [area, layout])

  function commitView(next: Camera) {
    viewRef.current = next
    setView(next)
  }

  function playPoint(event: { clientX: number; clientY: number }): {
    x: number
    y: number
    scale: number
  } | null {
    const viewport = viewportRef.current
    const current = viewRef.current
    if (!viewport || !current || current.zoom === 0) return null
    const rect = viewport.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left - current.x) / current.zoom,
      y: (event.clientY - rect.top - current.y) / current.zoom,
      scale: current.zoom,
    }
  }

  function endDrag() {
    dragRef.current = null
    setDragGroup(null)
    setNear(null)
  }

  function beginSlide() {
    if (slideFrameRef.current) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.034, (now - last) / 1000)
      last = now
      const map = offsetsRef.current
      for (const [id, body] of map) {
        settleSlide(body, dt)
        if (slideResting(body)) map.delete(id)
      }
      setOffsets(new Map(map))
      if (map.size === 0) {
        slideFrameRef.current = 0
        return
      }
      slideFrameRef.current = requestAnimationFrame(tick)
    }
    slideFrameRef.current = requestAnimationFrame(tick)
  }

  function launchSnap(before: Placement[], after: Placement[]) {
    if (!allowsMotion()) return
    const afterById = new Map(after.map((piece) => [piece.id, piece]))
    let nudged = false
    for (const piece of before) {
      const next = afterById.get(piece.id)
      if (!next) continue
      const dx = piece.x - next.x
      const dy = piece.y - next.y
      if (Math.hypot(dx, dy) < 0.2) continue
      const body = offsetsRef.current.get(piece.id) ?? {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      }
      body.x += dx
      body.y += dy
      offsetsRef.current.set(piece.id, body)
      nudged = true
    }
    if (!nudged) return
    setOffsets(new Map(offsetsRef.current))
    beginSlide()
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    panRef.current = null
    setPanning(false)
  }

  function onViewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) return
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    userAdjustedRef.current = true
    setPanning(true)
  }

  function onViewportPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    if (event.buttons === 0) {
      panRef.current = null
      setPanning(false)
      return
    }
    const current = viewRef.current
    if (!current) return
    const next = {
      ...current,
      x: current.x + (event.clientX - pan.x),
      y: current.y + (event.clientY - pan.y),
    }
    pan.x = event.clientX
    pan.y = event.clientY
    commitView(next)
  }

  function onPointerDown(
    event: React.PointerEvent<HTMLCanvasElement>,
    id: string,
  ) {
    if (event.button !== 0) return
    const point = playPoint(event)
    const placement = placementsRef.current.find((piece) => piece.id === id)
    if (!point || !placement) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      id,
      group: placement.group,
      grabX: point.x - placement.x,
      grabY: point.y - placement.y,
    }
    setFrontGroup(placement.group)
    setDragGroup(placement.group)
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    if (event.buttons === 0) {
      endDrag()
      return
    }
    const point = playPoint(event)
    if (!point) return
    const rawX = point.x - drag.grabX
    const rawY = point.y - drag.grabY
    const clamped = clampGroup(
      placementsRef.current,
      drag.group,
      drag.id,
      rawX,
      rawY,
      layout.cellW,
      layout.cellH,
      layout.pad,
      area,
    )
    const moved = moveGroup(
      placementsRef.current,
      drag.group,
      drag.id,
      clamped.x,
      clamped.y,
    )
    const limits = approachLimits(
      Math.min(layout.cellW, layout.cellH),
      point.scale,
    )
    const result = pullToNeighbors(
      moved,
      drag.group,
      layout.cellW,
      layout.cellH,
      limits.highlight,
      limits.snap,
    )
    const parked = result.placements.find((piece) => piece.id === drag.id)
    const held = parked
      ? clampGroup(
          result.placements,
          drag.group,
          drag.id,
          parked.x,
          parked.y,
          layout.cellW,
          layout.cellH,
          layout.pad,
          area,
        )
      : null
    const placements = held
      ? moveGroup(result.placements, drag.group, drag.id, held.x, held.y)
      : result.placements
    const anchor = placements.find((piece) => piece.id === drag.id)
    if (anchor && (anchor.x !== rawX || anchor.y !== rawY)) {
      drag.grabX = point.x - anchor.x
      drag.grabY = point.y - anchor.y
    }
    if (result.snapped && anchor) drag.group = anchor.group
    placementsRef.current = placements
    setPlacements(placements)
    setNear(result.near)
    setFrontGroup(drag.group)
    if (result.snapped) launchSnap(moved, placements)
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    endDrag()
  }

  const viewportClass = panning
    ? 'play-viewport play-viewport--panning'
    : 'play-viewport'

  return (
    <div className={active ? 'play-mode' : 'play-mode play-mode--inactive'}>
      <div
        ref={viewportRef}
        className={viewportClass}
        role="application"
        aria-label="Play area"
        data-zoom={view.zoom}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onAuxClick={(event) => event.preventDefault()}
      >
        {failed ? (
          <p className="banner banner--error">
            Could not load the puzzle image.
          </p>
        ) : (
          <div
            className="play-world"
            style={{
              width: layout.playW,
              height: layout.playH,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
          >
            <div
              className="play-limit"
              aria-hidden="true"
              style={{
                left: area.minX - (area.maxX - area.minX),
                top: area.minY - (area.maxY - area.minY),
                width: (area.maxX - area.minX) * 3,
                height: (area.maxY - area.minY) * 3,
              }}
            />
            <div
              className="play-field"
              aria-hidden="true"
              style={{
                left: area.minX,
                top: area.minY,
                width: area.maxX - area.minX,
                height: area.maxY - area.minY,
              }}
            />
            {model.pieces.map((piece) => {
              const placement = placements.find(
                (item) => item.col === piece.col && item.row === piece.row,
              )
              if (!placement) return null
              const slide = offsets.get(placement.id)
              return (
                <PieceCanvas
                  key={placement.id}
                  image={image}
                  piece={piece}
                  placement={placement}
                  layout={layout}
                  near={
                    near?.pieceId === placement.id ||
                    near?.neighborId === placement.id
                  }
                  offsetX={slide?.x ?? 0}
                  offsetY={slide?.y ?? 0}
                  raised={placement.group === frontGroup}
                  dragging={placement.group === dragGroup}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              )
            })}
          </div>
        )}
        <button
          type="button"
          className="button play-mode__leave"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onLeave}
        >
          Back
        </button>
      </div>
    </div>
  )
}

function PieceCanvas({
  image,
  piece,
  placement,
  layout,
  near,
  offsetX,
  offsetY,
  raised,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  image: HTMLImageElement | null
  piece: PieceModel
  placement: Placement
  layout: ScatteredBoard
  near: boolean
  offsetX: number
  offsetY: number
  raised: boolean
  dragging: boolean
  onPointerDown: (
    event: React.PointerEvent<HTMLCanvasElement>,
    id: string,
  ) => void
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { cellW, cellH, pad } = layout
  const width = cellW + pad * 2
  const height = cellH + pad * 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    drawPiece(canvas, image, piece, cellW, cellH, pad)
  }, [image, piece, cellW, cellH, pad])

  const glow = useFade(near)
  const className = ['piece', dragging ? 'piece--dragging' : '']
    .filter(Boolean)
    .join(' ')
  const shift =
    Math.hypot(offsetX, offsetY) > 0.05
      ? `translate(${offsetX}px, ${offsetY}px)`
      : undefined
  const style: React.CSSProperties & { '--piece-glow': number } = {
    left: placement.x - pad,
    top: placement.y - pad,
    width,
    height,
    zIndex: raised ? 3 : near || glow > 0.04 ? 2 : 1,
    transform: shift,
    '--piece-glow': glow,
  }
  if (glow <= 0.01) style.filter = 'none'

  return (
    <canvas
      ref={canvasRef}
      className={className}
      draggable={false}
      role="img"
      data-piece={placement.id}
      data-near={near ? 'true' : 'false'}
      aria-label={`Piece ${piece.row + 1}-${piece.col + 1}`}
      style={style}
      onPointerDown={(event) => onPointerDown(event, placement.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

interface Drag {
  pointerId: number
  id: string
  group: string
  grabX: number
  grabY: number
}

interface Pan {
  pointerId: number
  x: number
  y: number
}

function drawPiece(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  piece: PieceModel,
  cellW: number,
  cellH: number,
  pad: number,
): void {
  const width = cellW + pad * 2
  const height = cellH + pad * 2
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const bitmapW = Math.max(1, Math.round(width * dpr))
  const bitmapH = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
    canvas.width = bitmapW
    canvas.height = bitmapH
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const originX = piece.col * cellW - pad
  const originY = piece.row * cellH - pad
  trace(ctx, piece.points, originX, originY)
  ctx.save()
  ctx.clip()
  ctx.drawImage(image, -originX, -originY)
  ctx.restore()
  trace(ctx, piece.points, originX, originY)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.stroke()
}

function trace(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  originX: number,
  originY: number,
): void {
  const first = points[0]
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first.x - originX, first.y - originY)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    ctx.lineTo(point.x - originX, point.y - originY)
  }
  ctx.closePath()
}
