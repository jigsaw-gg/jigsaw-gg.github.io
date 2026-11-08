import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPuzzle, type PieceModel, type Point } from '../puzzle/cut.ts'
import type { PuzzleSetup } from '../puzzle/session.ts'

export function PuzzleBoard({ setup }: { setup: PuzzleSetup }) {
  const model = useMemo(() => buildPuzzle(setup), [setup])
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)

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

  if (failed) {
    return (
      <p className="banner banner--error">Could not load the puzzle image.</p>
    )
  }

  return (
    <div
      className="puzzle-board"
      style={{ gridTemplateColumns: `repeat(${model.cols}, minmax(0, 1fr))` }}
      aria-label={`${model.pieces.length} puzzle pieces`}
    >
      {model.pieces.map((piece) => (
        <PieceCanvas
          key={`${piece.col}-${piece.row}`}
          image={image}
          piece={piece}
          cellW={model.cellW}
          cellH={model.cellH}
          pad={model.pad}
        />
      ))}
    </div>
  )
}

function PieceCanvas({
  image,
  piece,
  cellW,
  cellH,
  pad,
}: {
  image: HTMLImageElement | null
  piece: PieceModel
  cellW: number
  cellH: number
  pad: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const width = cellW + pad * 2
  const height = cellH + pad * 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    drawPiece(canvas, image, piece, cellW, cellH, pad)
  }, [image, piece, cellW, cellH, pad])

  return (
    <canvas
      ref={canvasRef}
      className="piece"
      style={{ aspectRatio: `${width} / ${height}` }}
      aria-label={`Piece ${piece.row + 1}-${piece.col + 1}`}
    />
  )
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
