import { useEffect, useMemo, useRef, useState } from 'react'
import { isExpanded } from '../fullscreen.ts'
import { GAMEPAD_POINTER } from '../input/dualshock.ts'
import { getState as getGamepadState } from '../input/gamepadHandler.ts'
import { FullscreenButton } from './FullscreenButton.tsx'
import { WinCelebration } from './WinCelebration.tsx'
import { useI18n } from '../i18n/useI18n.ts'
import {
  PAN_SPEED_PX,
  PIECE_SPEED_PX,
  POINTER_SPEED_PX,
  TRIGGER_ZOOM_PER_SEC,
  VIEW_MARGIN,
  boundsVisible,
  cameraWithInterest,
  groupAtWorld,
  groupScreenCenter,
  groupWorldBounds,
  lookOffset,
  pickGroupInDirection,
  piecesVisible,
  type PadDirection,
} from '../puzzle/gamepadView.ts'
import {
  CRUISE_MAX_SPEED,
  createCruise,
  cruiseMargin,
  cruiseVelocity,
  cruiseZoom,
  edgePull,
  stepCruise,
  type CruiseBody,
  type EdgeBounds,
  type EdgePull,
} from '../puzzle/edgeCruise.ts'
import { buildPuzzle, type PieceModel, type Point } from '../puzzle/cut.ts'
import {
  approachLimits,
  cameraLimits,
  clampGroup,
  fitCamera,
  isPuzzleComplete,
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
import {
  HANDOVER_MS,
  halfEdgeBounds,
  handoverMarks,
  oppositeThumb,
  stickDeflection,
  stickDisc,
  STICK_MAX_SPEED,
  thumbSide,
  twoThumbLayout,
  type HandoverMarks,
  type StickDisc,
  type ThumbSide,
} from '../puzzle/twoThumb.ts'
import type { RemoteCursor } from '../puzzle/useWorldSync.ts'
import { hapticImpact, hapticNotification } from '../telegram/webApp.ts'

/** Nearby-piece glow fade, in milliseconds. */
const GLOW_MS = 260
/** How long the controller blink stays up after input starts. */
const GAMEPAD_BLINK_MS = 3000
/** Stick must rest this long before a controller drag is saved. */
const GAMEPAD_RELEASE_S = 0.12
const MOBILE_LAYOUT = '(max-width: 1100px)'
/** How long the win banner and side decorations stay visible. */
const WIN_CELEBRATE_MS = 3200
/** Ease the camera onto the finished puzzle over this many ms. */
const WIN_CAMERA_MS = 900
/**
 * Critically damped snap, in rad/s. The piece speeds up toward the join,
 * then settles on it.
 */
const SNAP_RESPONSE = 22

/** Comfortable inset so the finished board fills the view without crowding. */
function winFitMargin(viewportW: number, viewportH: number): number {
  return Math.max(72, Math.min(viewportW, viewportH) * 0.1)
}

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

interface GlowClock {
  sync: (active: boolean, pulse: number) => void
  stop: () => void
}

/**
 * Proximity eases the glow in and, once the piece leaves, back out.
 * Each join adds a cycle that fades all the way in and then all the way
 * out. A later move must not retarget that cycle, or a fast snap finishes
 * before the first frame and the highlight never appears.
 */
function createGlowClock(publish: (value: number) => void): GlowClock {
  const glow = {
    value: 0,
    phase: 'idle' as 'idle' | 'in' | 'hold' | 'out',
    from: 0,
    to: 0,
    started: 0,
    active: false,
    pulse: 0,
    pending: 0,
    outPays: false,
    frame: 0,
  }

  function kick() {
    if (glow.frame !== 0) return
    if (glow.phase !== 'in' && glow.phase !== 'out') return
    glow.frame = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    glow.frame = 0
    if (glow.phase !== 'in' && glow.phase !== 'out') return
    const span = glow.to - glow.from
    const t = Math.min(1, (now - glow.started) / GLOW_MS)
    const next = glow.from + span * easeInOut(t)
    glow.value = next
    publish(next)
    if (t < 1) {
      kick()
      return
    }
    finish(now)
  }

  function finish(now: number) {
    const pays = glow.phase === 'out' && glow.outPays
    glow.value = glow.to
    publish(glow.to)
    if (pays && glow.pending > 0) glow.pending -= 1
    glow.outPays = false
    glow.phase = 'idle'
    steer(now)
  }

  function begin(phase: 'in' | 'out', now: number) {
    glow.phase = phase
    glow.from = glow.value
    glow.to = phase === 'in' ? 1 : 0
    glow.started = now
    glow.outPays = phase === 'out' && glow.pending > 0
    if (Math.abs(glow.from - glow.to) < 0.001) {
      finish(now)
      return
    }
    kick()
  }

  function steer(now: number) {
    if (!allowsMotion()) {
      if (glow.frame !== 0) {
        cancelAnimationFrame(glow.frame)
        glow.frame = 0
      }
      glow.pending = 0
      glow.outPays = false
      glow.phase = glow.active ? 'hold' : 'idle'
      const next = glow.active ? 1 : 0
      glow.value = next
      publish(next)
      return
    }
    if (glow.phase === 'in') {
      if (!glow.active && glow.pending === 0) begin('out', now)
      else kick()
      return
    }
    if (glow.phase === 'out') {
      kick()
      return
    }
    if (glow.pending > 0) {
      if (glow.value >= 0.999) begin('out', now)
      else begin('in', now)
      return
    }
    if (glow.active) {
      if (glow.value < 0.999) begin('in', now)
      else glow.phase = 'hold'
      return
    }
    if (glow.value > 0.001) begin('out', now)
  }

  return {
    sync(active: boolean, pulse: number) {
      glow.active = active
      if (pulse > glow.pulse) glow.pending += pulse - glow.pulse
      glow.pulse = pulse
      steer(performance.now())
    },
    stop() {
      if (glow.frame === 0) return
      cancelAnimationFrame(glow.frame)
      glow.frame = 0
    },
  }
}

function usePieceGlow(active: boolean, pulse: number): number {
  const [value, setValue] = useState(0)
  const clock = useRef<GlowClock | null>(null)
  if (clock.current === null) clock.current = createGlowClock(setValue)

  useEffect(() => {
    clock.current?.sync(active, pulse)
  }, [active, pulse])

  useEffect(() => () => clock.current?.stop(), [])

  return value
}

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

function PuzzleTable({
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
  if (activeSeen.current !== active) {
    activeSeen.current = active
    if (!active) {
      panRef.current = null
      cruiseStickRef.current = null
      handoverRef.current = null
      if (dragRef.current) dragRef.current.handoverSince = null
      setPanning(false)
      setPanStick(null)
      setCruiseStick(null)
      setHandover(null)
    }
  }

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

  function present(follow: Camera): Camera {
    const interest = interestRef.current
    const group = padGroupRef.current
    const viewport = viewportRef.current
    if (
      !group ||
      !viewport ||
      Math.hypot(interest.x, interest.y) * Math.max(follow.zoom, 0) < 0.5
    ) {
      return follow
    }
    const rect = viewport.getBoundingClientRect()
    if (
      piecesVisible(
        follow,
        rect.width,
        rect.height,
        placementsRef.current,
        layout.cellW,
        layout.cellH,
      )
    ) {
      return follow
    }
    const bounds = groupWorldBounds(
      placementsRef.current,
      group,
      layout.cellW,
      layout.cellH,
    )
    if (!bounds) return follow
    const limits = cameraLimits(
      rect.width,
      rect.height,
      area,
      Math.min(layout.cellW, layout.cellH),
    )
    return cameraWithInterest(
      follow,
      bounds,
      interest.x,
      interest.y,
      rect.width,
      rect.height,
      limits.min,
      VIEW_MARGIN,
    )
  }

  function commitView(next: Camera) {
    followRef.current = next
    const shown = present(next)
    viewRef.current = shown
    setView(shown)
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

  function publishPointer(clientX: number, clientY: number) {
    if (!active) return
    const point = playPoint({ clientX, clientY })
    if (!point) return
    onPointer(point.x, point.y)
  }

  useEffect(() => {
    publishPointerRef.current = publishPointer
  })

  function finishDrag(commit: boolean) {
    if (!dragRef.current) return
    dragRef.current = null
    clearHandover()
    showCruiseStick(null)
    setDragGroup(null)
    setNear(null)
    if (commit) onDragEnd(placementsRef.current)
    else onDragCancel()
  }

  useEffect(() => {
    finishDragRef.current = finishDrag
    commitViewRef.current = commitView
    gamepadTickRef.current = gamepadTick
  })

  useEffect(() => {
    cruiseTickRef.current = cruiseTick
    stickTickRef.current = stickPanTick
  })

  useEffect(() => {
    if (!active) return
    let frame = 0
    let backup = 0
    const loop = (now: number) => {
      window.clearTimeout(backup)
      gamepadTickRef.current(now)
      frame = requestAnimationFrame(loop)
      // A visible page paints every frame. If it does not, keep reading the pad.
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

  function rememberMembers(drag: Drag) {
    drag.memberIds = new Set(
      placementsRef.current
        .filter((piece) => piece.group === drag.group)
        .map((piece) => piece.id),
    )
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

  function pulseGroup(group: string) {
    const ids = placementsRef.current
      .filter((piece) => piece.group === group)
      .map((piece) => piece.id)
    if (ids.length === 0) return
    setPulses((current) => {
      const next = new Map(current)
      for (const id of ids) next.set(id, (next.get(id) ?? 0) + 1)
      return next
    })
  }

  function twoThumbNow(rect: DOMRect | null): boolean {
    if (!rect) return false
    return twoThumbLayout(
      window.matchMedia(MOBILE_LAYOUT).matches,
      rect.width,
      rect.height,
    )
  }

  function clearHandover() {
    const drag = dragRef.current
    if (drag) drag.handoverSince = null
    window.clearTimeout(handoverTimerRef.current)
    handoverTimerRef.current = 0
    if (!handoverRef.current) return
    handoverRef.current = null
    setHandover(null)
  }

  function syncHandover(drag: Drag) {
    const rect = viewportRef.current?.getBoundingClientRect() ?? null
    if (!drag.thumb || !rect || !twoThumbNow(rect)) {
      clearHandover()
      return
    }
    const localX = drag.clientX - rect.left
    const localY = drag.clientY - rect.top
    const marks = handoverMarks(drag.thumb, localX, rect.width)
    if (!marks) {
      clearHandover()
      return
    }
    const now = performance.now()
    if (drag.handoverSince == null) drag.handoverSince = now
    const elapsed = now - drag.handoverSince
    if (elapsed >= HANDOVER_MS) {
      drag.thumb = oppositeThumb(drag.thumb)
      clearHandover()
      return
    }
    const toward = marks === '>>>' ? 1 : -1
    const view: HandoverView = {
      marks,
      x: rect.width / 2 + toward * 42,
      y: Math.min(rect.height - 36, Math.max(36, localY - 36)),
    }
    const prev = handoverRef.current
    if (
      !prev ||
      prev.marks !== view.marks ||
      Math.abs(prev.x - view.x) > 0.5 ||
      Math.abs(prev.y - view.y) > 0.5
    ) {
      handoverRef.current = view
      setHandover(view)
    }
    if (handoverTimerRef.current !== 0) return
    handoverTimerRef.current = window.setTimeout(
      () => {
        handoverTimerRef.current = 0
        const current = dragRef.current
        if (!current || current.pointerId !== drag.pointerId) return
        syncHandover(current)
      },
      Math.max(0, HANDOVER_MS - elapsed),
    )
  }

  function showCruiseStick(next: ThumbStickView | null) {
    if (!cruiseStickRef.current && !next) return
    cruiseStickRef.current = next
    setCruiseStick(next)
  }

  function cruiseStickView(
    drag: Drag,
    rect: DOMRect,
    pull: EdgePull,
  ): ThumbStickView | null {
    if (!drag.thumb || pull.speed < 24) return null
    const localX = drag.clientX - rect.left
    const localY = drag.clientY - rect.top
    const disc = stickDisc(localX, localY, rect.width, rect.height, drag.thumb)
    const strength = Math.min(1, pull.speed / CRUISE_MAX_SPEED)
    const reach = Math.max(strength, 0.35) * disc.radius
    return {
      side: drag.thumb,
      cx: localX - pull.x * reach,
      cy: localY - pull.y * reach,
      radius: disc.radius,
      knobX: localX,
      knobY: localY,
    }
  }

  function publishPanStick() {
    const pan = panRef.current
    if (!pan?.stick || !pan.disc || !pan.side) {
      setPanStick(null)
      return
    }
    const def = stickDeflection(pan.fingerX, pan.fingerY, pan.disc)
    setPanStick({
      side: pan.side,
      cx: pan.disc.cx,
      cy: pan.disc.cy,
      radius: pan.disc.radius,
      knobX: def.knobX,
      knobY: def.knobY,
    })
  }

  function pokeStickPan() {
    if (stickFrameRef.current !== 0) return
    stickFrameRef.current = requestAnimationFrame((now) => {
      stickFrameRef.current = 0
      stickTickRef.current(now)
    })
  }

  function stickPanTick(now: number) {
    const pan = panRef.current
    if (!pan?.stick || !pan.disc || pinchActiveRef.current) return
    if (pan.last === 0) {
      pan.last = now
      pokeStickPan()
      return
    }
    const dt = Math.min(0.05, Math.max(0, (now - pan.last) / 1000))
    pan.last = now
    const current = viewRef.current
    const viewport = viewportRef.current
    if (!current || !viewport) return
    const def = stickDeflection(pan.fingerX, pan.fingerY, pan.disc)
    const speed = def.amount * def.amount * STICK_MAX_SPEED
    if (speed > 1) {
      let next: Camera = {
        ...current,
        x: current.x + def.x * speed * dt,
        y: current.y + def.y * speed * dt,
      }
      const drag = dragRef.current
      if (drag && drag.pointerId !== pan.pointerId) {
        next = lockHeldPiece(next, drag, viewport)
      }
      userAdjustedRef.current = true
      commitView(next)
      const held = dragRef.current
      if (held) publishPointer(held.clientX, held.clientY)
    }
    if (panRef.current?.stick) pokeStickPan()
  }

  function lockHeldPiece(
    next: Camera,
    drag: Drag,
    viewport: HTMLDivElement,
  ): Camera {
    const savedGrabX = drag.grabX
    const savedGrabY = drag.grabY
    viewRef.current = next
    moveDragTo(drag.clientX, drag.clientY)
    const held = dragRef.current
    if (!held) return viewRef.current
    const anchor = placementsRef.current.find((piece) => piece.id === held.id)
    if (!anchor) return next
    const rect = viewport.getBoundingClientRect()
    const cursorX = held.clientX - rect.left
    const cursorY = held.clientY - rect.top
    const screenX = (anchor.x + savedGrabX) * next.zoom + next.x
    const screenY = (anchor.y + savedGrabY) * next.zoom + next.y
    const errX = screenX - cursorX
    const errY = screenY - cursorY
    if (Math.hypot(errX, errY) <= 0.75) return next
    held.grabX = savedGrabX
    held.grabY = savedGrabY
    return { ...next, x: next.x - errX, y: next.y - errY }
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    stopPan()
  }

  function stopPan() {
    panRef.current = null
    cancelAnimationFrame(stickFrameRef.current)
    stickFrameRef.current = 0
    setPanning(false)
    setPanStick(null)
  }

  function onViewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (boardLockedRef.current) return
    if (pinchActiveRef.current) return
    if (event.button !== 0 && event.button !== 1) return
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId) return
    const rect = viewportRef.current?.getBoundingClientRect() ?? null
    const thumbs = twoThumbNow(rect)
    if (drag && !thumbs) return
    if (panRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    userAdjustedRef.current = true
    if (thumbs && rect) {
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const side = thumbSide(localX, rect.width)
      panRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        stick: true,
        side,
        disc: stickDisc(localX, localY, rect.width, rect.height, side),
        fingerX: localX,
        fingerY: localY,
        last: 0,
      }
      publishPanStick()
      setPanning(true)
      pokeStickPan()
      return
    }
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      stick: false,
      side: null,
      disc: null,
      fingerX: 0,
      fingerY: 0,
      last: 0,
    }
    setPanning(true)
  }

  function onViewportPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pinchActiveRef.current) return
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    if (event.buttons === 0) {
      stopPan()
      publishPointer(event.clientX, event.clientY)
      return
    }
    if (pan.stick && pan.disc) {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      pan.fingerX = event.clientX - rect.left
      pan.fingerY = event.clientY - rect.top
      publishPanStick()
      publishPointer(event.clientX, event.clientY)
      return
    }
    const follow = followRef.current
    if (!follow) return
    const next = {
      ...follow,
      x: follow.x + (event.clientX - pan.x),
      y: follow.y + (event.clientY - pan.y),
    }
    pan.x = event.clientX
    pan.y = event.clientY
    commitView(next)
    publishPointer(event.clientX, event.clientY)
  }

  function onViewportPointerMoveCapture(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    onViewportPointerMove(event)
    if (panRef.current?.pointerId === event.pointerId) return
    publishPointer(event.clientX, event.clientY)
  }

  function onPointerDown(
    event: React.PointerEvent<HTMLCanvasElement>,
    id: string,
  ) {
    if (boardLockedRef.current) return
    if (pinchActiveRef.current) return
    if (event.button !== 0) return
    const held = dragRef.current
    if (held && held.pointerId !== event.pointerId) {
      const occupied = viewportRef.current?.getBoundingClientRect() ?? null
      if (twoThumbNow(occupied)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    const point = playPoint(event)
    const placement = placementsRef.current.find((piece) => piece.id === id)
    if (!point || !placement) return
    if (dragRef.current?.pointerId === GAMEPAD_POINTER) finishDrag(true)
    selectionRef.current = null
    padGroupRef.current = null
    padHoverRef.current = null
    padPointerRef.current = null
    interestRef.current = { x: 0, y: 0 }
    setPadGroup(null)
    setPadHoverGroup(null)
    setPadPointer(null)
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const memberIds = new Set(
      placementsRef.current
        .filter((piece) => piece.group === placement.group)
        .map((piece) => piece.id),
    )
    const rect = viewportRef.current?.getBoundingClientRect() ?? null
    const thumb =
      rect && twoThumbNow(rect)
        ? thumbSide(event.clientX - rect.left, rect.width)
        : null
    const cruise =
      thumb !== null ||
      (event.pointerType === 'touch' &&
        window.matchMedia(MOBILE_LAYOUT).matches)
    dragRef.current = {
      pointerId: event.pointerId,
      id,
      group: placement.group,
      grabX: point.x - placement.x,
      grabY: point.y - placement.y,
      memberIds,
      cruise,
      clientX: event.clientX,
      clientY: event.clientY,
      thumb,
      handoverSince: null,
    }
    if (cruise) beginCruise(event.clientX, event.clientY)
    setFrontGroup(placement.group)
    setDragGroup(placement.group)
    onDrag(placementsRef.current, placement.id)
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pinchActiveRef.current) return
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    if (event.buttons === 0) {
      finishDrag(true)
      return
    }
    drag.clientX = event.clientX
    drag.clientY = event.clientY
    const snapped = moveDragTo(event.clientX, event.clientY)
    if (snapped && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (dragRef.current?.cruise) pokeCruise()
    if (dragRef.current) syncHandover(dragRef.current)
  }

  function moveDragTo(clientX: number, clientY: number): boolean {
    const drag = dragRef.current
    if (!drag) return false
    const point = playPoint({ clientX, clientY })
    if (!point) return false
    const rawX = point.x - drag.grabX
    const rawY = point.y - drag.grabY
    const snapped = moveDragToWorld(rawX, rawY, point.scale)
    const held = dragRef.current
    if (!snapped && held && held.pointerId === drag.pointerId) {
      const anchor = placementsRef.current.find((piece) => piece.id === held.id)
      if (anchor && (anchor.x !== rawX || anchor.y !== rawY)) {
        held.grabX = point.x - anchor.x
        held.grabY = point.y - anchor.y
      }
    }
    return snapped
  }

  function moveDragToWorld(rawX: number, rawY: number, scale: number): boolean {
    const drag = dragRef.current
    if (!drag) return false
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
    const limits = approachLimits(Math.min(layout.cellW, layout.cellH), scale)
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
    if (result.snapped && anchor) drag.group = anchor.group
    placementsRef.current = placements
    rememberMembers(drag)
    setPlacements(placements)
    setFrontGroup(drag.group)
    if (result.snapped) {
      hapticImpact('medium')
      launchSnap(moved, placements)
      pulseGroup(drag.group)
      onDrag(placements, drag.id)
      if (drag.pointerId === GAMEPAD_POINTER) {
        padGroupRef.current = drag.group
        setPadGroup(drag.group)
        setNear(null)
        return false
      }
      finishDrag(true)
      return true
    }
    setNear(result.near)
    onDrag(placements, drag.id)
    return false
  }

  function viewportSize(): { width: number; height: number } | null {
    const viewport = viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return null
    return { width: rect.width, height: rect.height }
  }

  function cameraForViewport(width: number, height: number) {
    return cameraLimits(
      width,
      height,
      area,
      Math.min(layout.cellW, layout.cellH),
    )
  }

  function revealGroup(group: string) {
    const size = viewportSize()
    const follow = followRef.current
    if (!size || !follow) return
    if (
      piecesVisible(
        follow,
        size.width,
        size.height,
        placementsRef.current,
        layout.cellW,
        layout.cellH,
      )
    ) {
      return
    }
    const bounds = groupWorldBounds(
      placementsRef.current,
      group,
      layout.cellW,
      layout.cellH,
    )
    if (!bounds || boundsVisible(follow, size.width, size.height, bounds)) {
      return
    }
    const limits = cameraForViewport(size.width, size.height)
    const next = cameraWithInterest(
      follow,
      bounds,
      0,
      0,
      size.width,
      size.height,
      limits.min,
      VIEW_MARGIN,
    )
    if (
      next.zoom === follow.zoom &&
      next.x === follow.x &&
      next.y === follow.y
    ) {
      return
    }
    userAdjustedRef.current = true
    commitView(next)
  }

  function clearPadSelection() {
    if (dragRef.current?.pointerId === GAMEPAD_POINTER) finishDrag(true)
    selectionRef.current = null
    padGroupRef.current = null
    interestRef.current = { x: 0, y: 0 }
    setPadGroup(null)
    const follow = followRef.current
    if (
      follow.zoom !== viewRef.current.zoom ||
      follow.x !== viewRef.current.x ||
      follow.y !== viewRef.current.y
    ) {
      viewRef.current = follow
      setView(follow)
    }
  }

  function selectHoveredPad(id: string) {
    if (dragRef.current && dragRef.current.pointerId !== GAMEPAD_POINTER) {
      return
    }
    if (dragRef.current?.pointerId === GAMEPAD_POINTER) finishDrag(true)
    const placement = placementsRef.current.find((piece) => piece.id === id)
    if (!placement) return
    selectionRef.current = placement.id
    padGroupRef.current = placement.group
    setPadGroup(placement.group)
    setFrontGroup(placement.group)
    syncPadPointer(null, null, null)
    revealGroup(placement.group)
    beginGamepadDrag(placement.id)
    if (import.meta.env.DEV) {
      console.log(`gamepad board: select group=${placement.group}`)
    }
  }

  function syncPadPointer(
    next: { x: number; y: number } | null,
    hover: string | null,
    hoverId: string | null = null,
  ) {
    const prev = padPointerRef.current
    const prevHover = padHoverRef.current
    padPointerRef.current = next
    padHoverRef.current = hover
    padHoverIdRef.current = hoverId
    if (
      (next === null) !== (prev === null) ||
      (next !== null &&
        prev !== null &&
        (Math.abs(next.x - prev.x) > 0.5 || Math.abs(next.y - prev.y) > 0.5))
    ) {
      setPadPointer(next)
    }
    if (hover !== prevHover) setPadHoverGroup(hover)
  }

  /** Move the hover pointer onto a group in a screen direction (D-pad). */
  function hoverJump(
    direction: PadDirection,
    size: { width: number; height: number },
  ): void {
    const follow = followRef.current
    const current = padHoverRef.current
    const from = (current
      ? groupScreenCenter(
          placementsRef.current,
          current,
          layout.cellW,
          layout.cellH,
          follow,
        )
      : null) ??
      padPointerRef.current ?? {
        x: size.width / 2,
        y: size.height / 2,
      }
    const next = pickGroupInDirection(
      placementsRef.current,
      layout.cellW,
      layout.cellH,
      follow,
      from,
      current,
      direction,
    )
    if (!next) return
    const placement = placementsRef.current.find(
      (piece) => piece.id === next.id,
    )
    if (!placement) return
    revealGroup(next.group)
    const camera = followRef.current
    const zoom = camera.zoom > 0 ? camera.zoom : 1
    const bounds = groupWorldBounds(
      placementsRef.current,
      next.group,
      layout.cellW,
      layout.cellH,
    )
    const worldX = bounds
      ? (bounds.minX + bounds.maxX) / 2
      : placement.x + layout.cellW / 2
    const worldY = bounds
      ? (bounds.minY + bounds.maxY) / 2
      : placement.y + layout.cellH / 2
    syncPadPointer(
      {
        x: Math.min(size.width, Math.max(0, worldX * zoom + camera.x)),
        y: Math.min(size.height, Math.max(0, worldY * zoom + camera.y)),
      },
      next.group,
      next.id,
    )
    if (import.meta.env.DEV) {
      console.log(`gamepad board: hover ${direction} → group=${next.group}`)
    }
  }

  function beginGamepadDrag(id: string): boolean {
    const placement = placementsRef.current.find((piece) => piece.id === id)
    if (!placement) return false
    const existing = dragRef.current
    if (existing?.pointerId === GAMEPAD_POINTER) {
      if (existing.id === id) return true
      finishDrag(true)
    } else if (existing) {
      return false
    }
    const memberIds = new Set(
      placementsRef.current
        .filter((piece) => piece.group === placement.group)
        .map((piece) => piece.id),
    )
    dragRef.current = {
      pointerId: GAMEPAD_POINTER,
      id,
      group: placement.group,
      grabX: 0,
      grabY: 0,
      memberIds,
      cruise: false,
      clientX: 0,
      clientY: 0,
      thumb: null,
      handoverSince: null,
    }
    padGroupRef.current = placement.group
    setPadGroup(placement.group)
    setFrontGroup(placement.group)
    setDragGroup(placement.group)
    onDrag(placementsRef.current, placement.id)
    return true
  }

  function moveDragBy(
    dx: number,
    dy: number,
  ): { dx: number; dy: number } | null {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== GAMEPAD_POINTER) return null
    const before = placementsRef.current.find((piece) => piece.id === drag.id)
    if (!before) return null
    const scale = viewRef.current.zoom > 0 ? viewRef.current.zoom : 1
    moveDragToWorld(before.x + dx, before.y + dy, scale)
    const held = dragRef.current
    if (!held || held.pointerId !== GAMEPAD_POINTER) return null
    const after = placementsRef.current.find((piece) => piece.id === held.id)
    if (!after) return null
    return { dx: after.x - before.x, dy: after.y - before.y }
  }

  function gamepadTick(now: number) {
    const clock = padClockRef.current
    const dt =
      clock.last === 0
        ? 0
        : Math.min(0.05, Math.max(0, (now - clock.last) / 1000))
    clock.last = now
    const { pad, reading, receiving } = getGamepadState()
    const connected = pad !== null
    if (connected !== connectedRef.current) {
      connectedRef.current = connected
      setGamepadConnected(connected)
      if (!connected && helpOpenRef.current) {
        helpOpenRef.current = false
        setGamepadHelpOpen(false)
      }
    }
    if (receiving && !clock.latched) {
      clock.latched = true
      clock.showUntil = now + GAMEPAD_BLINK_MS
    }
    if (!receiving && now >= clock.showUntil) clock.latched = false
    const show = now < clock.showUntil
    if (show !== blinkRef.current) {
      blinkRef.current = show
      setGamepadBlink(show)
    }
    if (boardLockedRef.current) {
      if (dragRef.current?.pointerId === GAMEPAD_POINTER) finishDrag(true)
      syncPadPointer(null, null)
      return
    }
    if (!reading) {
      clock.l1 = false
      clock.r1 = false
      clock.triangle = false
      clock.up = false
      clock.down = false
      clock.leftPad = false
      clock.rightPad = false
      if (dragRef.current?.pointerId === GAMEPAD_POINTER) finishDrag(true)
      syncPadPointer(null, null)
      const interest = interestRef.current
      if (interest.x !== 0 || interest.y !== 0) {
        interestRef.current = { x: 0, y: 0 }
        const follow = followRef.current
        if (
          follow.zoom !== viewRef.current.zoom ||
          follow.x !== viewRef.current.x ||
          follow.y !== viewRef.current.y
        ) {
          viewRef.current = follow
          setView(follow)
        }
      }
      return
    }
    const l1Edge = reading.l1 && !clock.l1
    const triangleEdge = reading.triangle && !clock.triangle
    const upEdge = reading.up && !clock.up
    const downEdge = reading.down && !clock.down
    const leftEdge = reading.leftPad && !clock.leftPad
    const rightEdge = reading.rightPad && !clock.rightPad
    clock.l1 = reading.l1
    clock.r1 = reading.r1
    clock.triangle = reading.triangle
    clock.up = reading.up
    clock.down = reading.down
    clock.leftPad = reading.leftPad
    clock.rightPad = reading.rightPad
    if (triangleEdge) {
      const next = !helpOpenRef.current
      helpOpenRef.current = next
      setGamepadHelpOpen(next)
    }
    /** R1 halves stick speed while held. */
    const stickScale = reading.r1 ? 0.5 : 1
    const leftX = reading.left.x * stickScale
    const leftY = reading.left.y * stickScale
    const rightX = reading.right.x * stickScale
    const rightY = reading.right.y * stickScale
    const dpadDirection: PadDirection | null = rightEdge
      ? 'right'
      : leftEdge
        ? 'left'
        : downEdge
          ? 'down'
          : upEdge
            ? 'up'
            : null
    if (dt === 0) return

    const size = viewportSize()
    if (!size) return
    let follow = followRef.current
    const limits = cameraForViewport(size.width, size.height)
    const pull = reading.l2 - reading.r2
    if (pull !== 0 && follow.zoom > 0) {
      const selectedPiece = selectionRef.current
        ? placementsRef.current.find(
            (piece) => piece.id === selectionRef.current,
          )
        : undefined
      const bounds = selectedPiece
        ? groupWorldBounds(
            placementsRef.current,
            selectedPiece.group,
            layout.cellW,
            layout.cellH,
          )
        : null
      const worldX = bounds
        ? (bounds.minX + bounds.maxX) / 2
        : (size.width / 2 - follow.x) / follow.zoom
      const worldY = bounds
        ? (bounds.minY + bounds.maxY) / 2
        : (size.height / 2 - follow.y) / follow.zoom
      follow = zoomCamera(
        follow,
        worldX * follow.zoom + follow.x,
        worldY * follow.zoom + follow.y,
        Math.exp(pull * TRIGGER_ZOOM_PER_SEC * dt),
        limits.min,
        limits.max,
      )
    }

    if (!selectionRef.current) {
      interestRef.current = { x: 0, y: 0 }
      if (rightX !== 0 || rightY !== 0) {
        follow = {
          ...follow,
          x: follow.x - rightX * PAN_SPEED_PX * dt,
          y: follow.y - rightY * PAN_SPEED_PX * dt,
        }
      }
      if (dpadDirection) {
        hoverJump(dpadDirection, size)
        follow = followRef.current
      } else {
        let pointer = padPointerRef.current
        if (!pointer) {
          pointer = { x: size.width / 2, y: size.height / 2 }
        }
        pointer = {
          x: Math.min(
            size.width,
            Math.max(0, pointer.x + leftX * POINTER_SPEED_PX * dt),
          ),
          y: Math.min(
            size.height,
            Math.max(0, pointer.y + leftY * POINTER_SPEED_PX * dt),
          ),
        }
        const shownZoom = follow.zoom > 0 ? follow.zoom : 1
        const worldX = (pointer.x - follow.x) / shownZoom
        const worldY = (pointer.y - follow.y) / shownZoom
        const hit = groupAtWorld(
          placementsRef.current,
          worldX,
          worldY,
          layout.cellW,
          layout.cellH,
          padHoverRef.current,
        )
        syncPadPointer(pointer, hit?.group ?? null, hit?.id ?? null)
      }
      if (l1Edge && padHoverIdRef.current) {
        selectHoveredPad(padHoverIdRef.current)
      }
      followRef.current = follow
      if (
        follow.zoom !== viewRef.current.zoom ||
        follow.x !== viewRef.current.x ||
        follow.y !== viewRef.current.y
      ) {
        userAdjustedRef.current = true
        viewRef.current = follow
        setView(follow)
      }
      return
    }

    if (l1Edge) clearPadSelection()
    syncPadPointer(null, null, null)
    const fitAll = piecesVisible(
      follow,
      size.width,
      size.height,
      placementsRef.current,
      layout.cellW,
      layout.cellH,
    )
    const moving = leftX !== 0 || leftY !== 0
    if (moving && selectionRef.current) {
      clock.idle = 0
      if (!fitAll) {
        const held = placementsRef.current.find(
          (piece) => piece.id === selectionRef.current,
        )
        const bounds = held
          ? groupWorldBounds(
              placementsRef.current,
              held.group,
              layout.cellW,
              layout.cellH,
            )
          : null
        if (bounds && !boundsVisible(follow, size.width, size.height, bounds)) {
          follow = cameraWithInterest(
            follow,
            bounds,
            0,
            0,
            size.width,
            size.height,
            limits.min,
            VIEW_MARGIN,
          )
        }
      }
      if (beginGamepadDrag(selectionRef.current)) {
        const shownZoom = viewRef.current.zoom > 0 ? viewRef.current.zoom : 1
        const applied = moveDragBy(
          (leftX * PIECE_SPEED_PX * dt) / shownZoom,
          (leftY * PIECE_SPEED_PX * dt) / shownZoom,
        )
        if (applied && !fitAll) {
          follow = {
            ...follow,
            x: follow.x - applied.dx * follow.zoom,
            y: follow.y - applied.dy * follow.zoom,
          }
        }
      }
    } else if (dragRef.current?.pointerId === GAMEPAD_POINTER) {
      clock.idle += dt
      if (clock.idle >= GAMEPAD_RELEASE_S) {
        finishDrag(true)
        clock.idle = 0
      }
    }

    const look = !fitAll
      ? lookOffset(rightX, rightY, size.width, size.height, follow.zoom)
      : { x: 0, y: 0 }
    interestRef.current = look
    followRef.current = follow
    const shown = present(follow)
    if (
      shown.zoom === viewRef.current.zoom &&
      shown.x === viewRef.current.x &&
      shown.y === viewRef.current.y
    ) {
      return
    }
    userAdjustedRef.current = true
    viewRef.current = shown
    setView(shown)
  }

  function beginCruise(clientX: number, clientY: number) {
    const viewport = viewportRef.current
    const current = viewRef.current
    if (!viewport || !current) return
    const rect = viewport.getBoundingClientRect()
    const previous = cruiseRef.current
    cruiseRef.current = {
      body: createCruise(),
      baseZoom: previous?.baseZoom ?? current.zoom,
      anchorX: clientX - rect.left,
      anchorY: clientY - rect.top,
      lastTime: 0,
    }
    pokeCruise()
  }

  function pokeCruise() {
    if (cruiseFrameRef.current !== 0) return
    cruiseFrameRef.current = requestAnimationFrame((now) => {
      cruiseTickRef.current(now)
    })
  }

  function cruiseTick(now: number) {
    cruiseFrameRef.current = 0
    interestRef.current = { x: 0, y: 0 }
    const cruise = cruiseRef.current
    if (!cruise || pinchActiveRef.current) {
      cruiseRef.current = null
      showCruiseStick(null)
      return
    }
    // A direct grab of the table cancels edge cruise. A thumb stick keeps
    // the held piece and takes the camera for itself.
    if (panRef.current && !panRef.current.stick) {
      cruiseRef.current = null
      showCruiseStick(null)
      return
    }
    const viewport = viewportRef.current
    const current = viewRef.current
    if (!viewport || !current) return
    if (cruise.lastTime === 0) {
      cruise.lastTime = now
      pokeCruise()
      return
    }
    const dt = Math.min(0.05, Math.max(0, (now - cruise.lastTime) / 1000))
    cruise.lastTime = now
    const drag = dragRef.current
    const stickOwnsCamera = panRef.current?.stick === true
    if (stickOwnsCamera) {
      cruise.body = { speed: 0, heading: cruise.body.heading, accel: 0 }
    }
    if (!drag?.cruise || stickOwnsCamera) {
      showCruiseStick(null)
      if (drag?.cruise && stickOwnsCamera) {
        pokeCruise()
        return
      }
      if (easeCruiseZoom(cruise, current, viewport, dt)) {
        cruiseRef.current = null
      } else pokeCruise()
      return
    }
    const rect = viewport.getBoundingClientRect()
    const full = touchEdgeBounds(isExpanded(), rect)
    const margin = cruiseMargin(full.right - full.left, full.bottom - full.top)
    const bounds = drag.thumb ? halfEdgeBounds(full, drag.thumb) : full
    const pull = edgePull(
      drag.clientX,
      drag.clientY,
      bounds,
      margin,
      CRUISE_MAX_SPEED,
    )
    showCruiseStick(cruiseStickView(drag, rect, pull))
    const body = stepCruise(cruise.body, pull, dt)
    cruise.body = body
    const velocity = cruiseVelocity(body)
    const limits = cameraLimits(
      rect.width,
      rect.height,
      area,
      Math.min(layout.cellW, layout.cellH),
    )
    const cursorX = drag.clientX - rect.left
    const cursorY = drag.clientY - rect.top
    cruise.anchorX = cursorX
    cruise.anchorY = cursorY
    const zoom = cruiseZoom(
      cruise.baseZoom,
      body.speed,
      CRUISE_MAX_SPEED,
      limits.min,
      allowsMotion(),
    )
    const travel = Math.hypot(velocity.x, velocity.y) * dt
    if (travel < 0.02 && Math.abs(zoom - current.zoom) < 1e-4) {
      if (cruiseLive(cruise, pull.speed, current.zoom)) pokeCruise()
      return
    }
    let next: Camera = {
      zoom: current.zoom,
      x: current.x + velocity.x * dt,
      y: current.y + velocity.y * dt,
    }
    if (Math.abs(zoom - next.zoom) > 1e-4 && next.zoom > 0) {
      next = zoomCamera(
        next,
        cursorX,
        cursorY,
        zoom / next.zoom,
        limits.min,
        limits.max,
      )
    }
    const savedGrabX = drag.grabX
    const savedGrabY = drag.grabY
    interestRef.current = { x: 0, y: 0 }
    followRef.current = next
    viewRef.current = next
    moveDragTo(drag.clientX, drag.clientY)
    const held = dragRef.current
    if (held?.cruise) {
      const anchor = placementsRef.current.find((piece) => piece.id === held.id)
      if (anchor) {
        const screenX = (anchor.x + savedGrabX) * next.zoom + next.x
        const screenY = (anchor.y + savedGrabY) * next.zoom + next.y
        const errX = screenX - cursorX
        const errY = screenY - cursorY
        if (Math.hypot(errX, errY) > 0.75) {
          next = { ...next, x: next.x - errX, y: next.y - errY }
          held.grabX = savedGrabX
          held.grabY = savedGrabY
          const blocked = Math.hypot(errX, errY)
          const kept = travel > 0.4 ? Math.max(0, 1 - blocked / travel) : 0
          cruise.body = {
            ...cruise.body,
            speed: cruise.body.speed * (0.72 + 0.28 * kept),
            accel: Math.min(0, cruise.body.accel * kept),
          }
        }
      }
    }
    userAdjustedRef.current = true
    followRef.current = next
    viewRef.current = next
    setView(next)
    publishPointer(drag.clientX, drag.clientY)
    if (dragRef.current?.cruise) {
      if (cruiseLive(cruise, pull.speed, next.zoom)) pokeCruise()
      return
    }
    if (Math.abs(next.zoom - cruise.baseZoom) > 1e-3) pokeCruise()
  }

  function easeCruiseZoom(
    cruise: ActiveCruise,
    current: Camera,
    viewport: HTMLDivElement,
    dt: number,
  ): boolean {
    const rect = viewport.getBoundingClientRect()
    const limits = cameraLimits(
      rect.width,
      rect.height,
      area,
      Math.min(layout.cellW, layout.cellH),
    )
    const goal = Math.min(limits.max, Math.max(limits.min, cruise.baseZoom))
    if (!(current.zoom > 0) || Math.abs(goal - current.zoom) < 0.002) {
      return true
    }
    const zoom = allowsMotion()
      ? current.zoom + (goal - current.zoom) * (1 - Math.exp(-dt / 0.24))
      : goal
    const next = zoomCamera(
      current,
      cruise.anchorX,
      cruise.anchorY,
      zoom / current.zoom,
      limits.min,
      limits.max,
    )
    userAdjustedRef.current = true
    commitView(next)
    return Math.abs(goal - next.zoom) < 0.002
  }

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

function ThumbStick({ stick }: { stick: ThumbStickView }) {
  const halfStyle: React.CSSProperties =
    stick.side === 'left'
      ? { left: 10, width: 'calc(50% - 20px)' }
      : { left: 'calc(50% + 10px)', width: 'calc(50% - 20px)' }
  return (
    <div className="thumb-stick" aria-hidden="true">
      <div className="thumb-stick__half" style={halfStyle} />
      <svg className="thumb-stick__arm">
        <line x1={stick.cx} y1={stick.cy} x2={stick.knobX} y2={stick.knobY} />
      </svg>
      <div
        className="thumb-stick__range"
        style={{
          left: stick.cx,
          top: stick.cy,
          width: stick.radius * 2,
          height: stick.radius * 2,
        }}
      />
      <div
        className="thumb-stick__knob"
        style={{ left: stick.knobX, top: stick.knobY }}
      />
    </div>
  )
}

function PadGroupHighlight({
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
  return (
    <div
      className={
        mode === 'selected'
          ? 'pad-group-hl pad-group-hl--selected'
          : 'pad-group-hl pad-group-hl--hover'
      }
      aria-hidden="true"
      style={{
        left: bounds.minX - pad,
        top: bounds.minY - pad,
        width: bounds.maxX - bounds.minX + pad * 2,
        height: bounds.maxY - bounds.minY + pad * 2,
      }}
    />
  )
}

function PieceCanvas({
  image,
  piece,
  placement,
  layout,
  near,
  pulse,
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
  pulse: number
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
  const { messages } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { cellW, cellH, pad } = layout
  const width = cellW + pad * 2
  const height = cellH + pad * 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    drawPiece(canvas, image, piece, cellW, cellH, pad)
  }, [image, piece, cellW, cellH, pad])

  const glow = usePieceGlow(near, pulse)
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
      aria-label={messages.play.piece(piece.row + 1, piece.col + 1)}
      style={style}
      onPointerDown={(event) => onPointerDown(event, placement.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

function RemotePointer({
  cursor,
  zoom,
}: {
  cursor: RemoteCursor
  zoom: number
}) {
  const { messages } = useI18n()
  const scale = zoom > 0 ? 1 / zoom : 1
  return (
    <div
      className="remote-cursor"
      role="img"
      aria-label={messages.play.pointer(cursor.name)}
      style={{
        left: cursor.x,
        top: cursor.y,
        color: cursor.color,
        transform: `scale(${scale})`,
      }}
    >
      <svg
        className="remote-cursor__arrow"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        aria-hidden="true"
      >
        <path
          d="M1 1 L1 14.2 L4.7 10.6 L8.4 16.2 L10.6 15 L6.9 9.4 L11.6 9 Z"
          fill="currentColor"
          stroke="#fff"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      <span className="remote-cursor__name">
        <span>{cursor.name}</span>
      </span>
    </div>
  )
}

function GamepadIcon() {
  return (
    <svg className="gamepad-blink__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 7.2h9.6c2.2 0 4.2 1.9 4.2 4.4 0 2.7-1.4 4.9-3.3 4.9-1.1 0-1.8-.6-2.5-1.5l-.6-.8H9.4l-.6.8c-.7.9-1.4 1.5-2.5 1.5-1.9 0-3.3-2.2-3.3-4.9 0-2.5 2-4.4 4.2-4.4z"
      />
      <path
        fill="var(--surface)"
        d="M8.1 10.2h1.3v1.1h1.1v1.3H9.4v1.1H8.1v-1.1H7v-1.3h1.1zM15.2 11.4a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm2.2-1.3a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"
      />
    </svg>
  )
}

function TriangleGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M8 2.2 14.2 13.4H1.8L8 2.2zm0 2.6L3.9 12.2h8.2L8 4.8z"
      />
    </svg>
  )
}

interface Drag {
  pointerId: number
  id: string
  group: string
  grabX: number
  grabY: number
  memberIds: Set<string>
  cruise: boolean
  clientX: number
  clientY: number
  thumb: ThumbSide | null
  handoverSince: number | null
}

interface ThumbStickView {
  side: ThumbSide
  cx: number
  cy: number
  radius: number
  knobX: number
  knobY: number
}

interface HandoverView {
  marks: HandoverMarks
  x: number
  y: number
}

interface ActiveCruise {
  body: CruiseBody
  baseZoom: number
  anchorX: number
  anchorY: number
  lastTime: number
}

interface Pan {
  pointerId: number
  x: number
  y: number
  stick: boolean
  side: ThumbSide | null
  disc: StickDisc | null
  fingerX: number
  fingerY: number
  last: number
}

interface ScreenPoint {
  id: number
  x: number
  y: number
  target: EventTarget | null
}

interface PinchSpan {
  dist: number
  x: number
  y: number
}

function cruiseLive(
  cruise: ActiveCruise,
  pullSpeed: number,
  zoom: number,
): boolean {
  return (
    pullSpeed > 1 ||
    cruise.body.speed > 0.5 ||
    Math.abs(cruise.body.accel) > 1 ||
    Math.abs(zoom - cruise.baseZoom) > 1e-3
  )
}

function touchEdgeBounds(fullscreen: boolean, canvas: DOMRect): EdgeBounds {
  if (!fullscreen) {
    return {
      left: canvas.left,
      top: canvas.top,
      right: canvas.right,
      bottom: canvas.bottom,
    }
  }
  const visual = window.visualViewport
  const left = visual?.offsetLeft ?? 0
  const top = visual?.offsetTop ?? 0
  const width = visual?.width ?? window.innerWidth
  const height = visual?.height ?? window.innerHeight
  return { left, top, right: left + width, bottom: top + height }
}

function pinchSpan(points: readonly ScreenPoint[]): PinchSpan | null {
  const first = points[0]
  const second = points[1]
  if (!first || !second) return null
  return {
    dist: Math.hypot(second.x - first.x, second.y - first.y),
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

function isScreenControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, label') !== null
  )
}

function releaseCaptured(viewport: HTMLElement, point: ScreenPoint): void {
  const target = point.target
  if (target instanceof Element && target.hasPointerCapture(point.id)) {
    target.releasePointerCapture(point.id)
  }
  if (viewport.hasPointerCapture(point.id)) {
    viewport.releasePointerCapture(point.id)
  }
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
  paintBevel(ctx, piece.points, originX, originY)
  ctx.restore()
}

// Light sits at 10:30 on the clock, so edges facing up-left catch it.
const BEVEL_PX = 3
const LIGHT_HOURS = 10.5
const BEVEL_BANDS = [
  { reach: BEVEL_PX, alpha: 0.28 },
  { reach: BEVEL_PX * 0.72, alpha: 0.32 },
  { reach: BEVEL_PX * 0.45, alpha: 0.38 },
  { reach: BEVEL_PX * 0.22, alpha: 0.46 },
  { reach: BEVEL_PX * 0.08, alpha: 0.55 },
]

interface PlanePoint {
  x: number
  y: number
}

interface BevelRun {
  facing: number
  points: PlanePoint[]
}

function paintBevel(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  originX: number,
  originY: number,
): void {
  const ring = pieceRing(points, originX, originY)
  if (ring.length < 3) return
  const light = clockVector(LIGHT_HOURS)
  const facing = edgeFacing(ring, light)
  const runs = bevelRuns(ring, facing)
  const corners = bevelCorners(ring, facing)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'
  for (const band of BEVEL_BANDS) {
    ctx.lineWidth = band.reach * 2
    for (const run of runs) {
      ctx.strokeStyle = bevelStyle(run.facing, band.alpha)
      ctx.beginPath()
      const first = run.points[0]
      if (!first) continue
      ctx.moveTo(first.x, first.y)
      for (let index = 1; index < run.points.length; index += 1) {
        const point = run.points[index]
        if (point) ctx.lineTo(point.x, point.y)
      }
      ctx.stroke()
    }
    for (const corner of corners) {
      ctx.fillStyle = bevelStyle(corner.facing, band.alpha)
      ctx.beginPath()
      ctx.arc(corner.x, corner.y, band.reach, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function pieceRing(
  points: Point[],
  originX: number,
  originY: number,
): PlanePoint[] {
  const ring: PlanePoint[] = []
  for (const point of points) {
    const next = { x: point.x - originX, y: point.y - originY }
    const prev = ring[ring.length - 1]
    if (prev && Math.hypot(prev.x - next.x, prev.y - next.y) < 0.05) continue
    ring.push(next)
  }
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (
    first &&
    last &&
    ring.length > 1 &&
    Math.hypot(first.x - last.x, first.y - last.y) < 0.05
  ) {
    ring.pop()
  }
  return ring
}

function clockVector(hours: number): PlanePoint {
  const angle = (hours / 12) * Math.PI * 2
  return { x: Math.sin(angle), y: -Math.cos(angle) }
}

function edgeFacing(ring: PlanePoint[], light: PlanePoint): number[] {
  const count = ring.length
  const normals: PlanePoint[] = []
  for (let index = 0; index < count; index += 1) {
    const from = ring[index]
    const to = ring[(index + 1) % count]
    if (!from || !to) {
      normals.push({ x: 0, y: 0 })
      continue
    }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    normals.push({ x: dy / length, y: -dx / length })
  }
  return normals.map((normal, index) => {
    const prev = normals[(index + count - 1) % count] ?? normal
    const next = normals[(index + 1) % count] ?? normal
    let x = prev.x + normal.x + next.x
    let y = prev.y + normal.y + next.y
    const length = Math.hypot(x, y) || 1
    x /= length
    y /= length
    return x * light.x + y * light.y
  })
}

function bevelRuns(ring: PlanePoint[], facing: number[]): BevelRun[] {
  const count = ring.length
  const bucket = (value: number) => Math.round(value * 16)
  let origin = 0
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    if (bucket(facing[index] ?? 0) !== bucket(facing[next] ?? 0)) {
      origin = next
      break
    }
  }
  const runs: BevelRun[] = []
  let runStart = 0
  let runBucket = bucket(facing[origin] ?? 0)
  let facingSum = facing[origin] ?? 0
  for (let step = 1; step <= count; step += 1) {
    const edge = (origin + step) % count
    const done = step === count
    const edgeBucket = bucket(facing[edge] ?? 0)
    if (!done && edgeBucket === runBucket) {
      facingSum += facing[edge] ?? 0
      continue
    }
    const points: PlanePoint[] = []
    for (let cursor = runStart; cursor <= step; cursor += 1) {
      const point = ring[(origin + cursor) % count]
      if (point) points.push(point)
    }
    const edges = step - runStart
    runs.push({ facing: facingSum / edges, points })
    runStart = step
    runBucket = edgeBucket
    facingSum = facing[edge] ?? 0
  }
  return runs
}

function bevelCorners(
  ring: PlanePoint[],
  facing: number[],
): Array<PlanePoint & { facing: number }> {
  const count = ring.length
  const corners: Array<PlanePoint & { facing: number }> = []
  for (let index = 0; index < count; index += 1) {
    const prev = ring[(index + count - 1) % count]
    const point = ring[index]
    const next = ring[(index + 1) % count]
    if (!prev || !point || !next) continue
    if (turnAngle(prev, point, next) < 0.55) continue
    const before = facing[(index + count - 1) % count] ?? 0
    const after = facing[index] ?? 0
    corners.push({ x: point.x, y: point.y, facing: (before + after) / 2 })
  }
  return corners
}

function turnAngle(from: PlanePoint, at: PlanePoint, to: PlanePoint): number {
  const abx = at.x - from.x
  const aby = at.y - from.y
  const bcx = to.x - at.x
  const bcy = to.y - at.y
  const left = Math.hypot(abx, aby) || 1
  const right = Math.hypot(bcx, bcy) || 1
  const dot = (abx / left) * (bcx / right) + (aby / left) * (bcy / right)
  return Math.acos(Math.min(1, Math.max(-1, dot)))
}

function bevelStyle(facing: number, alpha: number): string {
  const lit = Math.min(1, Math.max(0, (facing + 1) / 2))
  const blend = lit * lit * (3 - 2 * lit)
  const r = Math.round(6 + (214 - 6) * blend)
  const g = Math.round(18 + (230 - 18) * blend)
  const b = Math.round(44 + (248 - 44) * blend)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
