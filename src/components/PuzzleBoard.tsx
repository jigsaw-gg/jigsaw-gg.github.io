import { useEffect, useMemo, useRef, useState } from 'react'
import { isExpanded } from '../fullscreen.ts'
import { FullscreenButton } from './FullscreenButton.tsx'
import { useI18n } from '../i18n/useI18n.ts'
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
import { hapticImpact } from '../telegram/webApp.ts'

/** Nearby-piece glow fade, in milliseconds. */
const GLOW_MS = 260
const MOBILE_LAYOUT = '(max-width: 1100px)'
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
  const [panning, setPanning] = useState(false)
  const [panStick, setPanStick] = useState<ThumbStickView | null>(null)
  const [cruiseStick, setCruiseStick] = useState<ThumbStickView | null>(null)
  const [handover, setHandover] = useState<HandoverView | null>(null)
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
  const dragRef = useRef<Drag | null>(null)
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
      window.clearTimeout(handoverTimerRef.current)
    }
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
    const yielded = yieldNonce !== yieldSeen.current
    yieldSeen.current = yieldNonce
    const shared = sharedPlacements
    if (yielded) {
      dragRef.current = null
      clearHandover()
      showCruiseStick(null)
      setDragGroup(null)
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
      onPointerGone()
    }
  }, [active, onPointerGone])

  useEffect(() => () => onPointerGone(), [onPointerGone])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
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
      const zoomed = zoomCamera(
        current,
        prev.x - rect.left,
        prev.y - rect.top,
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
      viewRef.current = camera
      setView(camera)
    }

    const onDown = (event: PointerEvent) => {
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
  })

  useEffect(() => {
    cruiseTickRef.current = cruiseTick
    stickTickRef.current = stickPanTick
  })

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
    rememberMembers(drag)
    setPlacements(placements)
    setFrontGroup(drag.group)
    if (result.snapped) {
      hapticImpact('medium')
      launchSnap(moved, placements)
      pulseGroup(drag.group)
      onDrag(placements, drag.id)
      finishDrag(true)
      return true
    }
    setNear(result.near)
    onDrag(placements, drag.id)
    return false
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

  const viewportClass = panning
    ? 'play-viewport play-viewport--panning'
    : 'play-viewport'

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
            {cursors.map((cursor) => (
              <RemotePointer key={cursor.id} cursor={cursor} zoom={view.zoom} />
            ))}
          </div>
        )}
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
