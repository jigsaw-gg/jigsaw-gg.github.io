import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPuzzle, type PieceModel, type Point } from '../puzzle/cut.ts'
import {
  approachLimits,
  cameraLimits,
  clampGroup,
  fitCamera,
  moveGroup,
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
  const area = useMemo(
    () => playArea(layout.playW, layout.playH),
    [layout.playW, layout.playH],
  )
  const [view, setView] = useState<Camera>(() =>
    fitCamera(
      window.innerWidth,
      window.innerHeight,
      playArea(layout.playW, layout.playH),
    ),
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
    const viewport = viewportRef.current
    if (!viewport) return
    const fit = () => {
      if (userAdjustedRef.current) return
      const rect = viewport.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const next = fitCamera(rect.width, rect.height, area)
      viewRef.current = next
      setView(next)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [area])

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

  const className = [
    'piece',
    near ? 'piece--near' : '',
    dragging ? 'piece--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <canvas
      ref={canvasRef}
      className={className}
      draggable={false}
      role="img"
      data-piece={placement.id}
      data-near={near ? 'true' : 'false'}
      aria-label={`Piece ${piece.row + 1}-${piece.col + 1}`}
      style={{
        left: placement.x - pad,
        top: placement.y - pad,
        width,
        height,
        zIndex: raised ? 3 : near ? 2 : 1,
      }}
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
