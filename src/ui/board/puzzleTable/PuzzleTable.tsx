import { useEffect, useMemo, useRef, useState } from 'react'
import { GAMEPAD_POINTER } from '../../../input/dualshock.ts'
import { FullscreenButton } from '../../components/FullscreenButton.tsx'
import { WinCelebration } from '../../components/WinCelebration.tsx'
import { useI18n } from '../../i18n/useI18n.ts'
import { buildPuzzle } from '../../../jigsaw/index.ts'
import {
  cameraLimits,
  fitCamera,
  isPuzzleComplete,
  pieceBounds,
  playArea,
  scatterPieces,
  zoomCamera,
  type Camera,
  type NearPair,
  type Placement,
} from '../../../world/placement.ts'
import type { PuzzleSetup } from '../../../play/session.ts'
import type { RemoteCursor } from '../../../play/useGameWorld.ts'
import { hapticNotification } from '../../../telegram/webApp.ts'
import {
  GamepadIcon,
  ThumbStick,
  TriangleGlyph,
  type HandoverView,
  type ThumbStickView,
} from './boardChrome.tsx'
import { PadGroupHighlight } from './PadGroupHighlight.tsx'
import { PieceCanvas } from './PieceCanvas.tsx'
import { RemotePointer } from './RemotePointer.tsx'
import {
  WIN_CAMERA_MS,
  WIN_CELEBRATE_MS,
  winFitMargin,
  type ActiveCruise,
  type Drag,
  type Pan,
  type PinchSpan,
  type ScreenPoint,
  type SlideOffset,
  allowsMotion,
  isScreenControl,
  pinchSpan,
  releaseCaptured,
} from './puzzleTableShared.ts'
import { wirePuzzleTableInput } from './puzzleTableInputWire.ts'
import type { PuzzleTableInputState } from './puzzleTableInputState.ts'

export function PuzzleTable({
  setup,
  active,
  placements: sharedPlacements,
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
  const { messages } = useI18n()
  const model = useMemo(() => buildPuzzle(setup), [setup])
  const layout = useMemo(
    () => scatterPieces(model, setup.seed),
    [model, setup.seed],
  )
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [placements, setPlacements] = useState(sharedPlacements)
  const [near, setNear] = useState<NearPair | null>(null)
  const [pulses, setPulses] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )
  const [frontGroup, setFrontGroup] = useState<string | null>(null)
  const [dragGroup, setDragGroup] = useState<string | null>(null)
  const [padGroup, setPadGroup] = useState<string | null>(null)
  const [padHoverGroup, setPadHoverGroup] = useState<string | null>(null)
  const [padPointer, setPadPointer] = useState<{
    x: number
    y: number
  } | null>(null)
  const [gamepadBlink, setGamepadBlink] = useState(false)
  const [gamepadConnected, setGamepadConnected] = useState(false)
  const [gamepadHelpOpen, setGamepadHelpOpen] = useState(false)
  const [boardActive, setBoardActive] = useState(active)
  if (boardActive !== active) {
    setBoardActive(active)
    if (!active) {
      setPadGroup(null)
      setPadHoverGroup(null)
      setPadPointer(null)
      setGamepadBlink(false)
      setGamepadConnected(false)
      setGamepadHelpOpen(false)
    }
  }
  const [panning, setPanning] = useState(false)
  const [panStick, setPanStick] = useState<ThumbStickView | null>(null)
  const [cruiseStick, setCruiseStick] = useState<ThumbStickView | null>(null)
  const [handover, setHandover] = useState<HandoverView | null>(null)
  const [boardLocked, setBoardLocked] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const boardLockedRef = useRef(false)
  const winHandledRef = useRef(false)
  const winCameraFrameRef = useRef(0)
  const winHideTimerRef = useRef(0)
  const offsetsRef = useRef(new Map<string, SlideOffset>())
  const slideFrameRef = useRef(0)
  const [offsets, setOffsets] = useState<ReadonlyMap<string, SlideOffset>>(
    () => new Map(),
  )
  const area = useMemo(
    () => playArea(layout.playW, layout.playH),
    [layout.playW, layout.playH],
  )
  const opening = useMemo(() => {
    const pieces = pieceBounds(
      layout.placements,
      layout.cellW,
      layout.cellH,
      layout.pad,
    )
    const { reserve } = layout
    return {
      minX: Math.min(pieces.minX, reserve.minX),
      minY: Math.min(pieces.minY, reserve.minY),
      maxX: Math.max(pieces.maxX, reserve.maxX),
      maxY: Math.max(pieces.maxY, reserve.maxY),
    }
  }, [layout])
  const [view, setView] = useState<Camera>(() =>
    fitCamera(window.innerWidth, window.innerHeight, opening, 0),
  )
  const placementsRef = useRef(sharedPlacements)
  const yieldSeen = useRef(yieldNonce)
  const publishPointerRef = useRef<(x: number, y: number) => void>(() => {})
  const viewRef = useRef(view)
  const followRef = useRef(view)
  const dragRef = useRef<Drag | null>(null)
  const padGroupRef = useRef<string | null>(null)
  const padHoverRef = useRef<string | null>(null)
  const padHoverIdRef = useRef<string | null>(null)
  const padPointerRef = useRef<{ x: number; y: number } | null>(null)
  const selectionRef = useRef<string | null>(null)
  const interestRef = useRef({ x: 0, y: 0 })
  const blinkRef = useRef(false)
  const connectedRef = useRef(false)
  const helpOpenRef = useRef(false)
  const padClockRef = useRef({
    last: 0,
    l1: false,
    r1: false,
    triangle: false,
    up: false,
    down: false,
    leftPad: false,
    rightPad: false,
    idle: 0,
    showUntil: 0,
    latched: false,
  })
  const commitViewRef = useRef<(camera: Camera) => void>(() => {})
  const gamepadTickRef = useRef<(now: number) => void>(() => {})
  const panRef = useRef<Pan | null>(null)
  const pinchActiveRef = useRef(false)
  const finishDragRef = useRef<(commit: boolean) => void>(() => {})
  const cruiseRef = useRef<ActiveCruise | null>(null)
  const cruiseFrameRef = useRef(0)
  const cruiseTickRef = useRef<(now: number) => void>(() => {})
  const stickFrameRef = useRef(0)
  const stickTickRef = useRef<(now: number) => void>(() => {})
  const handoverTimerRef = useRef(0)
  const handoverRef = useRef<HandoverView | null>(null)
  const cruiseStickRef = useRef<ThumbStickView | null>(null)
  const userAdjustedRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const activeSeen = useRef(active)
  // eslint-disable-next-line react-hooks/refs -- edge-detect when parent `active` flips
  if (activeSeen.current !== active) {
    // eslint-disable-next-line react-hooks/refs
    activeSeen.current = active
    if (!active) {
      // Sync reset when the board deactivates (matches legacy PuzzleBoard behavior).
      /* eslint-disable react-hooks/refs -- ref and state cleanup on `active` edge */
      panRef.current = null
      cruiseStickRef.current = null
      handoverRef.current = null
      const drag = dragRef.current
      if (drag) drag.handoverSince = null
      /* eslint-enable react-hooks/refs */
      setPanning(false)
      setPanStick(null)
      setCruiseStick(null)
      setHandover(null)
    }
  }
  const tableInputState = useMemo(
    (): PuzzleTableInputState => ({
      active,
      layout,
      area,
      viewportRef,
      placementsRef,
      viewRef,
      followRef,
      dragRef,
      padGroupRef,
      padHoverRef,
      padHoverIdRef,
      padPointerRef,
      selectionRef,
      interestRef,
      boardLockedRef,
      pinchActiveRef,
      panRef,
      userAdjustedRef,
      offsetsRef,
      slideFrameRef,
      handoverTimerRef,
      handoverRef,
      cruiseStickRef,
      stickFrameRef,
      stickTickRef,
      cruiseRef,
      cruiseFrameRef,
      cruiseTickRef,
      padClockRef,
      blinkRef,
      connectedRef,
      helpOpenRef,
      setView,
      setOffsets,
      setPlacements,
      setFrontGroup,
      setDragGroup,
      setNear,
      setPulses,
      setHandover,
      setCruiseStick,
      setPanStick,
      setPanning,
      setPadGroup,
      setPadHoverGroup,
      setPadPointer,
      setGamepadConnected,
      setGamepadBlink,
      setGamepadHelpOpen,
      onPointer,
      onDrag,
      onDragEnd,
      onDragCancel,
    }),
    [active, layout, area, onPointer, onDrag, onDragEnd, onDragCancel],
  )
  const tableActions = useMemo(
    () => wirePuzzleTableInput(() => tableInputState),
    [tableInputState],
  )

  const {
    finishDrag,
    clearHandover,
    showCruiseStick,
    onViewportPointerDown,
    onViewportPointerMoveCapture,
    onPointerDown,
    onPointerMove,
    endPan,
  } = tableActions

  useEffect(() => {
    publishPointerRef.current = tableActions.publishPointer
  })
  useEffect(() => {
    finishDragRef.current = tableActions.finishDrag
    commitViewRef.current = tableActions.commitView
    gamepadTickRef.current = tableActions.gamepadTick
    cruiseTickRef.current = tableActions.cruiseTick
    stickTickRef.current = tableActions.stickPanTick
  })
  useEffect(() => {
    if (!active) return
    let frame = 0
    let backup = 0
    const loop = (now: number) => {
      window.clearTimeout(backup)
      gamepadTickRef.current(now)
      frame = requestAnimationFrame(loop)
      backup = window.setTimeout(() => {
        cancelAnimationFrame(frame)
        loop(performance.now())
      }, 50)
    }
    frame = requestAnimationFrame(loop)
    backup = window.setTimeout(() => {
      cancelAnimationFrame(frame)
      loop(performance.now())
    }, 50)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(backup)
    }
  }, [active])
  useEffect(() => {
    const onPageHide = () => {
      if (!dragRef.current) return
      finishDrag(true)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  })

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
    return () => {
      cancelAnimationFrame(slideFrameRef.current)
      cancelAnimationFrame(cruiseFrameRef.current)
      cancelAnimationFrame(stickFrameRef.current)
      cancelAnimationFrame(winCameraFrameRef.current)
      window.clearTimeout(handoverTimerRef.current)
      window.clearTimeout(winHideTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const fit = () => {
      const rect = viewport.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      if (boardLockedRef.current) {
        const bounds = pieceBounds(
          placementsRef.current,
          layout.cellW,
          layout.cellH,
          layout.pad,
        )
        const next = fitCamera(
          rect.width,
          rect.height,
          bounds,
          winFitMargin(rect.width, rect.height),
        )
        interestRef.current = { x: 0, y: 0 }
        followRef.current = next
        viewRef.current = next
        setView(next)
        return
      }
      if (userAdjustedRef.current) return
      const next = fitCamera(rect.width, rect.height, opening, 0)
      interestRef.current = { x: 0, y: 0 }
      followRef.current = next
      viewRef.current = next
      setView(next)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [opening, layout.cellW, layout.cellH, layout.pad])

  const puzzleComplete = isPuzzleComplete(placements)
  useEffect(() => {
    if (!active || !puzzleComplete || winHandledRef.current) return
    winHandledRef.current = true
    boardLockedRef.current = true
    setBoardLocked(true)
    setCelebrating(true)
    hapticNotification('success')

    if (dragRef.current) finishDragRef.current(true)
    panRef.current = null
    cruiseRef.current = null
    cancelAnimationFrame(cruiseFrameRef.current)
    cruiseFrameRef.current = 0
    cancelAnimationFrame(stickFrameRef.current)
    stickFrameRef.current = 0
    setPanning(false)
    setPanStick(null)
    setCruiseStick(null)
    setHandover(null)
    handoverRef.current = null
    window.clearTimeout(handoverTimerRef.current)
    handoverTimerRef.current = 0
    setNear(null)
    setPadGroup(null)
    setPadHoverGroup(null)
    setPadPointer(null)
    selectionRef.current = null
    padGroupRef.current = null
    padHoverRef.current = null
    padPointerRef.current = null
    interestRef.current = { x: 0, y: 0 }

    const viewport = viewportRef.current
    if (viewport) {
      const rect = viewport.getBoundingClientRect()
      if (rect.width >= 2 && rect.height >= 2) {
        const from = followRef.current
        const bounds = pieceBounds(
          placementsRef.current,
          layout.cellW,
          layout.cellH,
          layout.pad,
        )
        const to = fitCamera(
          rect.width,
          rect.height,
          bounds,
          winFitMargin(rect.width, rect.height),
        )
        userAdjustedRef.current = true
        cancelAnimationFrame(winCameraFrameRef.current)
        if (!allowsMotion()) {
          followRef.current = to
          viewRef.current = to
          setView(to)
        } else {
          const started = performance.now()
          const tick = (now: number) => {
            const t = Math.min(1, (now - started) / WIN_CAMERA_MS)
            const ease = 1 - (1 - t) ** 3
            const next = {
              zoom: from.zoom + (to.zoom - from.zoom) * ease,
              x: from.x + (to.x - from.x) * ease,
              y: from.y + (to.y - from.y) * ease,
            }
            followRef.current = next
            viewRef.current = next
            setView(next)
            if (t < 1) {
              winCameraFrameRef.current = requestAnimationFrame(tick)
              return
            }
            winCameraFrameRef.current = 0
          }
          winCameraFrameRef.current = requestAnimationFrame(tick)
        }
      }
    }

    window.clearTimeout(winHideTimerRef.current)
    winHideTimerRef.current = window.setTimeout(() => {
      winHideTimerRef.current = 0
      setCelebrating(false)
    }, WIN_CELEBRATE_MS)
  }, [active, puzzleComplete, layout.cellW, layout.cellH, layout.pad])

  useEffect(() => {
    const yielded = yieldNonce !== yieldSeen.current
    yieldSeen.current = yieldNonce
    const shared = sharedPlacements
    if (yielded) {
      dragRef.current = null
      clearHandover()
      showCruiseStick(null)
      setDragGroup(null)
      selectionRef.current = null
      padGroupRef.current = null
      padHoverRef.current = null
      padPointerRef.current = null
      setPadGroup(null)
      setPadHoverGroup(null)
      setPadPointer(null)
      interestRef.current = { x: 0, y: 0 }
      setNear(null)
      offsetsRef.current.clear()
      setOffsets(new Map())
      placementsRef.current = shared
      setPlacements(shared)
      onDragCancel()
      return
    }
    const drag = dragRef.current
    if (!drag) {
      placementsRef.current = shared
      setPlacements(shared)
      return
    }
    const local = new Map(
      placementsRef.current.map((piece) => [piece.id, piece]),
    )
    const merged = shared.map((piece) =>
      drag.memberIds.has(piece.id) ? (local.get(piece.id) ?? piece) : piece,
    )
    placementsRef.current = merged
    setPlacements(merged)
  }, [sharedPlacements, yieldNonce, onDragCancel])

  useEffect(() => {
    if (!active) {
      cruiseRef.current = null
      cancelAnimationFrame(cruiseFrameRef.current)
      cruiseFrameRef.current = 0
      panRef.current = null
      cancelAnimationFrame(stickFrameRef.current)
      stickFrameRef.current = 0
      window.clearTimeout(handoverTimerRef.current)
      handoverTimerRef.current = 0
      if (dragRef.current?.pointerId === GAMEPAD_POINTER) {
        finishDragRef.current(true)
      }
      selectionRef.current = null
      padGroupRef.current = null
      padHoverRef.current = null
      padPointerRef.current = null
      interestRef.current = { x: 0, y: 0 }
      blinkRef.current = false
      onPointerGone()
    }
  }, [active, onPointerGone])

  useEffect(() => () => onPointerGone(), [onPointerGone])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (boardLockedRef.current) return
      const current = viewRef.current
      if (!current) return
      cruiseRef.current = null
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
      const follow = followRef.current
      const cursorX = event.clientX - rect.left
      const cursorY = event.clientY - rect.top
      const worldX = (cursorX - current.x) / current.zoom
      const worldY = (cursorY - current.y) / current.zoom
      const next = zoomCamera(
        follow,
        worldX * follow.zoom + follow.x,
        worldY * follow.zoom + follow.y,
        Math.exp(-delta * 0.0016),
        limits.min,
        limits.max,
      )
      userAdjustedRef.current = true
      commitViewRef.current(next)
      publishPointerRef.current(event.clientX, event.clientY)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [area, layout])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const points: ScreenPoint[] = []
    let pinch: PinchSpan | null = null

    const applyPinch = (prev: PinchSpan, next: PinchSpan) => {
      const current = viewRef.current
      if (!current || prev.dist < 12 || next.dist < 12) return
      const rect = viewport.getBoundingClientRect()
      const limits = cameraLimits(
        rect.width,
        rect.height,
        area,
        Math.min(layout.cellW, layout.cellH),
      )
      const follow = followRef.current
      const cursorX = prev.x - rect.left
      const cursorY = prev.y - rect.top
      const worldX = (cursorX - current.x) / current.zoom
      const worldY = (cursorY - current.y) / current.zoom
      const zoomed = zoomCamera(
        follow,
        worldX * follow.zoom + follow.x,
        worldY * follow.zoom + follow.y,
        next.dist / prev.dist,
        limits.min,
        limits.max,
      )
      const camera = {
        zoom: zoomed.zoom,
        x: zoomed.x + (next.x - prev.x),
        y: zoomed.y + (next.y - prev.y),
      }
      userAdjustedRef.current = true
      commitViewRef.current(camera)
    }

    const onDown = (event: PointerEvent) => {
      if (boardLockedRef.current) return
      if (isScreenControl(event.target)) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (points.some((point) => point.id === event.pointerId)) return
      points.push({
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.target,
      })
      if (points.length < 2) return
      event.preventDefault()
      event.stopPropagation()
      if (points.length > 2) return
      cruiseRef.current = null
      finishDragRef.current(true)
      panRef.current = null
      cancelAnimationFrame(stickFrameRef.current)
      stickFrameRef.current = 0
      setPanning(false)
      setPanStick(null)
      cruiseStickRef.current = null
      setCruiseStick(null)
      handoverRef.current = null
      setHandover(null)
      for (const point of points) releaseCaptured(viewport, point)
      pinchActiveRef.current = true
      pinch = pinchSpan(points)
    }

    const onMove = (event: PointerEvent) => {
      const point = points.find((item) => item.id === event.pointerId)
      if (!point) return
      point.x = event.clientX
      point.y = event.clientY
      if (!pinchActiveRef.current) return
      const next = pinchSpan(points)
      if (!next || !pinch) return
      event.preventDefault()
      event.stopPropagation()
      applyPinch(pinch, next)
      pinch = next
    }

    const onUp = (event: PointerEvent) => {
      const index = points.findIndex((point) => point.id === event.pointerId)
      if (index < 0) return
      const pinching = pinchActiveRef.current
      points.splice(index, 1)
      if (!pinching) return
      event.stopPropagation()
      if (points.length >= 2) {
        pinch = pinchSpan(points)
        return
      }
      pinch = null
      pinchActiveRef.current = false
    }

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2) return
      event.preventDefault()
    }

    viewport.addEventListener('pointerdown', onDown, { capture: true })
    viewport.addEventListener('pointermove', onMove, { capture: true })
    viewport.addEventListener('pointerup', onUp, { capture: true })
    viewport.addEventListener('pointercancel', onUp, { capture: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      pinchActiveRef.current = false
      viewport.removeEventListener('pointerdown', onDown, { capture: true })
      viewport.removeEventListener('pointermove', onMove, { capture: true })
      viewport.removeEventListener('pointerup', onUp, { capture: true })
      viewport.removeEventListener('pointercancel', onUp, { capture: true })
      viewport.removeEventListener('touchmove', onTouchMove)
    }
  }, [area, layout])

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    finishDrag(true)
  }

  const viewportClass = [
    'play-viewport',
    panning ? 'play-viewport--panning' : '',
    boardLocked ? 'play-viewport--won' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={active ? 'play-mode' : 'play-mode play-mode--inactive'}>
      <div
        ref={viewportRef}
        className={viewportClass}
        role="application"
        aria-label={messages.play.playArea}
        data-zoom={view.zoom}
        onPointerDown={onViewportPointerDown}
        onPointerMoveCapture={onViewportPointerMoveCapture}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={() => onPointerGone()}
        onAuxClick={(event) => event.preventDefault()}
      >
        {failed ? (
          <p className="banner banner--error">{messages.play.imageError}</p>
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
                    near !== null &&
                    (placement.group === near.group ||
                      placement.group === near.neighborGroup)
                  }
                  pulse={pulses.get(placement.id) ?? 0}
                  offsetX={slide?.x ?? 0}
                  offsetY={slide?.y ?? 0}
                  raised={
                    placement.group === frontGroup ||
                    raisedGroups.includes(placement.group)
                  }
                  dragging={placement.group === dragGroup}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              )
            })}
            {padGroup ? (
              <PadGroupHighlight
                placements={placements}
                group={padGroup}
                cellW={layout.cellW}
                cellH={layout.cellH}
                pad={layout.pad}
                mode="selected"
              />
            ) : null}
            {padHoverGroup && padHoverGroup !== padGroup ? (
              <PadGroupHighlight
                placements={placements}
                group={padHoverGroup}
                cellW={layout.cellW}
                cellH={layout.cellH}
                pad={layout.pad}
                mode="hover"
              />
            ) : null}
            {cursors.map((cursor) => (
              <RemotePointer key={cursor.id} cursor={cursor} zoom={view.zoom} />
            ))}
          </div>
        )}
        {padPointer ? (
          <div
            className={
              padHoverGroup
                ? 'gamepad-pointer gamepad-pointer--hot'
                : 'gamepad-pointer'
            }
            aria-hidden="true"
            style={{ left: padPointer.x, top: padPointer.y }}
          />
        ) : null}
        {gamepadBlink ? (
          <div
            className="gamepad-blink"
            role="img"
            aria-label={messages.play.gamepad}
          >
            <GamepadIcon />
          </div>
        ) : null}
        {celebrating ? <WinCelebration label={messages.play.win} /> : null}
        {gamepadConnected && !gamepadHelpOpen ? (
          <div className="gamepad-help-cue" aria-hidden="true">
            <span>{messages.play.gamepadHelpCue}</span>
            <span className="gamepad-help-cue__sep">–</span>
            <TriangleGlyph className="gamepad-help-cue__glyph" />
          </div>
        ) : null}
        {gamepadHelpOpen ? (
          <div
            className="gamepad-help"
            role="dialog"
            aria-modal="true"
            aria-label={messages.play.gamepadHelpTitle}
          >
            <div className="gamepad-help__panel">
              <div className="gamepad-help__head">
                <h2 className="gamepad-help__title">
                  {messages.play.gamepadHelpTitle}
                </h2>
                <button
                  type="button"
                  className="button gamepad-help__close"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    helpOpenRef.current = false
                    setGamepadHelpOpen(false)
                  }}
                >
                  {messages.play.gamepadHelpClose}
                </button>
              </div>
              <ul className="gamepad-help__list">
                {(
                  [
                    ['△', messages.play.gamepadHelp.triangle],
                    ['L stick', messages.play.gamepadHelp.leftStick],
                    ['R stick', messages.play.gamepadHelp.rightStick],
                    ['L1', messages.play.gamepadHelp.l1],
                    ['R1', messages.play.gamepadHelp.r1],
                    ['L2', messages.play.gamepadHelp.l2],
                    ['R2', messages.play.gamepadHelp.r2],
                    ['D-pad', messages.play.gamepadHelp.dpad],
                    ['✕', messages.play.gamepadHelp.cross],
                  ] as const
                ).map(([control, detail]) => (
                  <li key={control} className="gamepad-help__row">
                    <span className="gamepad-help__control">{control}</span>
                    <span className="gamepad-help__detail">{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="button play-mode__leave"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onLeave}
        >
          {messages.play.back}
        </button>
        <FullscreenButton className="play-mode__fullscreen" />
        {panStick ? <ThumbStick stick={panStick} /> : null}
        {cruiseStick ? <ThumbStick stick={cruiseStick} /> : null}
        {handover ? (
          <div
            className="thumb-handover"
            style={{ left: handover.x, top: handover.y }}
            role="status"
            aria-label={
              handover.marks === '>>>'
                ? messages.play.handoverRight
                : messages.play.handoverLeft
            }
          >
            {handover.marks}
          </div>
        ) : null}
      </div>
    </div>
  )
}
