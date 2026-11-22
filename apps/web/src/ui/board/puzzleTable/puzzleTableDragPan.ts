import type { EdgePull } from './edgeCruise.ts'
import { GAMEPAD_POINTER } from '../../../input/dualshock.ts'
import {
  VIEW_MARGIN,
  piecesVisible,
  groupWorldBounds,
  cameraWithInterest,
} from '../../../input/gamepadView.ts'
import { CRUISE_MAX_SPEED } from './edgeCruise.ts'
import { event as otelEvent } from '../../../otel/index.ts'
import {
  approachLimits,
  cameraLimits,
  clampGroup,
  moveGroup,
  pullToNeighbors,
  type Camera,
  type Placement,
} from '../../../world/placement.ts'
import {
  HANDOVER_MS,
  handoverMarks,
  oppositeThumb,
  stickDeflection,
  stickDisc,
  STICK_MAX_SPEED,
  thumbSide,
  twoThumbLayout,
} from './twoThumb.ts'
import { hapticImpact } from '../../../telegram/webApp.ts'
import type { HandoverView, ThumbStickView } from './boardChrome.tsx'
import {
  MOBILE_LAYOUT,
  allowsMotion,
  settleSlide,
  slideResting,
  type Drag,
} from './puzzleTableShared.ts'
import type {
  PuzzleTableActions,
  PuzzleTableInputState,
} from './puzzleTableInputState.ts'

export type PuzzleTableDragPanActions = Pick<
  PuzzleTableActions,
  | 'present'
  | 'commitView'
  | 'playPoint'
  | 'publishPointer'
  | 'finishDrag'
  | 'rememberMembers'
  | 'beginSlide'
  | 'launchSnap'
  | 'pulseGroup'
  | 'twoThumbNow'
  | 'clearHandover'
  | 'syncHandover'
  | 'showCruiseStick'
  | 'cruiseStickView'
  | 'publishPanStick'
  | 'pokeStickPan'
  | 'stickPanTick'
  | 'lockHeldPiece'
  | 'endPan'
  | 'stopPan'
  | 'onViewportPointerDown'
  | 'onViewportPointerMove'
  | 'onViewportPointerMoveCapture'
  | 'onPointerDown'
  | 'onPointerMove'
  | 'moveDragTo'
  | 'moveDragToWorld'
>

export function createPuzzleTableDragPan(
  s: () => PuzzleTableInputState,
  a: () => PuzzleTableActions,
): PuzzleTableDragPanActions {
  function present(follow: Camera): Camera {
    const interest = s().interestRef.current
    const group = s().padGroupRef.current
    const viewport = s().viewportRef.current
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
        s().placementsRef.current,
        s().layout.cellW,
        s().layout.cellH,
      )
    ) {
      return follow
    }
    const bounds = groupWorldBounds(
      s().placementsRef.current,
      group,
      s().layout.cellW,
      s().layout.cellH,
    )
    if (!bounds) return follow
    const limits = cameraLimits(
      rect.width,
      rect.height,
      s().area,
      Math.min(s().layout.cellW, s().layout.cellH),
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
    s().followRef.current = next
    const shown = present(next)
    s().viewRef.current = shown
    s().setView(shown)
  }

  function playPoint(event: { clientX: number; clientY: number }): {
    x: number
    y: number
    scale: number
  } | null {
    const viewport = s().viewportRef.current
    const current = s().viewRef.current
    if (!viewport || !current || current.zoom === 0) return null
    const rect = viewport.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left - current.x) / current.zoom,
      y: (event.clientY - rect.top - current.y) / current.zoom,
      scale: current.zoom,
    }
  }

  function publishPointer(clientX: number, clientY: number) {
    if (!s().active) return
    const point = playPoint({ clientX, clientY })
    if (!point) return
    s().onPointer(point.x, point.y)
  }

  function finishDrag(commit: boolean) {
    const drag = s().dragRef.current
    if (!drag) return
    otelEvent('input', 'piece.drag_end', {
      pieceId: drag.id,
      group: drag.group,
      commit,
    })
    s().dragRef.current = null
    clearHandover()
    showCruiseStick(null)
    s().setDragGroup(null)
    s().setNear(null)
    if (commit) s().onDragEnd(s().placementsRef.current)
    else s().onDragCancel()
  }

  function rememberMembers(drag: Drag) {
    drag.memberIds = new Set(
      s()
        .placementsRef.current.filter((piece) => piece.group === drag.group)
        .map((piece) => piece.id),
    )
  }

  function beginSlide() {
    if (s().slideFrameRef.current) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.034, (now - last) / 1000)
      last = now
      const map = s().offsetsRef.current
      for (const [id, body] of map) {
        settleSlide(body, dt)
        if (slideResting(body)) map.delete(id)
      }
      s().setOffsets(new Map(map))
      if (map.size === 0) {
        s().slideFrameRef.current = 0
        return
      }
      s().slideFrameRef.current = requestAnimationFrame(tick)
    }
    s().slideFrameRef.current = requestAnimationFrame(tick)
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
      const body = s().offsetsRef.current.get(piece.id) ?? {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      }
      body.x += dx
      body.y += dy
      s().offsetsRef.current.set(piece.id, body)
      nudged = true
    }
    if (!nudged) return
    s().setOffsets(new Map(s().offsetsRef.current))
    beginSlide()
  }

  function pulseGroup(group: string) {
    const ids = s()
      .placementsRef.current.filter((piece) => piece.group === group)
      .map((piece) => piece.id)
    if (ids.length === 0) return
    s().setPulses((current) => {
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
    const drag = s().dragRef.current
    if (drag) drag.handoverSince = null
    window.clearTimeout(s().handoverTimerRef.current)
    s().handoverTimerRef.current = 0
    if (!s().handoverRef.current) return
    s().handoverRef.current = null
    s().setHandover(null)
  }

  function syncHandover(drag: Drag) {
    const rect = s().viewportRef.current?.getBoundingClientRect() ?? null
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
    const prev = s().handoverRef.current
    if (
      !prev ||
      prev.marks !== view.marks ||
      Math.abs(prev.x - view.x) > 0.5 ||
      Math.abs(prev.y - view.y) > 0.5
    ) {
      s().handoverRef.current = view
      s().setHandover(view)
    }
    if (s().handoverTimerRef.current !== 0) return
    s().handoverTimerRef.current = window.setTimeout(
      () => {
        s().handoverTimerRef.current = 0
        const current = s().dragRef.current
        if (!current || current.pointerId !== drag.pointerId) return
        syncHandover(current)
      },
      Math.max(0, HANDOVER_MS - elapsed),
    )
  }

  function showCruiseStick(next: ThumbStickView | null) {
    if (!s().cruiseStickRef.current && !next) return
    s().cruiseStickRef.current = next
    s().setCruiseStick(next)
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
    const pan = s().panRef.current
    if (!pan?.stick || !pan.disc || !pan.side) {
      s().setPanStick(null)
      return
    }
    const def = stickDeflection(pan.fingerX, pan.fingerY, pan.disc)
    s().setPanStick({
      side: pan.side,
      cx: pan.disc.cx,
      cy: pan.disc.cy,
      radius: pan.disc.radius,
      knobX: def.knobX,
      knobY: def.knobY,
    })
  }

  function pokeStickPan() {
    if (s().stickFrameRef.current !== 0) return
    s().stickFrameRef.current = requestAnimationFrame((now) => {
      s().stickFrameRef.current = 0
      s().stickTickRef.current(now)
    })
  }

  function stickPanTick(now: number) {
    const pan = s().panRef.current
    if (!pan?.stick || !pan.disc || s().pinchActiveRef.current) return
    if (pan.last === 0) {
      pan.last = now
      pokeStickPan()
      return
    }
    const dt = Math.min(0.05, Math.max(0, (now - pan.last) / 1000))
    pan.last = now
    const current = s().viewRef.current
    const viewport = s().viewportRef.current
    if (!current || !viewport) return
    const def = stickDeflection(pan.fingerX, pan.fingerY, pan.disc)
    const speed = def.amount * def.amount * STICK_MAX_SPEED
    if (speed > 1) {
      let next: Camera = {
        ...current,
        x: current.x + def.x * speed * dt,
        y: current.y + def.y * speed * dt,
      }
      const drag = s().dragRef.current
      if (drag && drag.pointerId !== pan.pointerId) {
        next = lockHeldPiece(next, drag, viewport)
      }
      s().userAdjustedRef.current = true
      commitView(next)
      const held = s().dragRef.current
      if (held) publishPointer(held.clientX, held.clientY)
    }
    if (s().panRef.current?.stick) pokeStickPan()
  }

  function lockHeldPiece(
    next: Camera,
    drag: Drag,
    viewport: HTMLDivElement,
  ): Camera {
    const savedGrabX = drag.grabX
    const savedGrabY = drag.grabY
    s().viewRef.current = next
    moveDragTo(drag.clientX, drag.clientY)
    const held = s().dragRef.current
    if (!held) return s().viewRef.current
    const anchor = s().placementsRef.current.find(
      (piece) => piece.id === held.id,
    )
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
    const pan = s().panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    stopPan()
  }

  function stopPan() {
    s().panRef.current = null
    cancelAnimationFrame(s().stickFrameRef.current)
    s().stickFrameRef.current = 0
    s().setPanning(false)
    s().setPanStick(null)
  }

  function onViewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (s().boardLockedRef.current) return
    if (s().pinchActiveRef.current) return
    if (event.button !== 0 && event.button !== 1) return
    const drag = s().dragRef.current
    if (drag?.pointerId === event.pointerId) return
    const rect = s().viewportRef.current?.getBoundingClientRect() ?? null
    const thumbs = twoThumbNow(rect)
    if (drag && !thumbs) return
    if (s().panRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    s().userAdjustedRef.current = true
    if (thumbs && rect) {
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const side = thumbSide(localX, rect.width)
      s().panRef.current = {
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
      s().setPanning(true)
      pokeStickPan()
      return
    }
    s().panRef.current = {
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
    s().setPanning(true)
  }

  function onViewportPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (s().pinchActiveRef.current) return
    const pan = s().panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    if (event.buttons === 0) {
      stopPan()
      publishPointer(event.clientX, event.clientY)
      return
    }
    if (pan.stick && pan.disc) {
      const rect = s().viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      pan.fingerX = event.clientX - rect.left
      pan.fingerY = event.clientY - rect.top
      publishPanStick()
      publishPointer(event.clientX, event.clientY)
      return
    }
    const follow = s().followRef.current
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
    if (s().panRef.current?.pointerId === event.pointerId) return
    publishPointer(event.clientX, event.clientY)
  }

  function onPointerDown(
    event: React.PointerEvent<HTMLCanvasElement>,
    id: string,
  ) {
    if (s().boardLockedRef.current) return
    if (s().pinchActiveRef.current) return
    if (event.button !== 0) return
    const held = s().dragRef.current
    if (held && held.pointerId !== event.pointerId) {
      const occupied = s().viewportRef.current?.getBoundingClientRect() ?? null
      if (twoThumbNow(occupied)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    const point = playPoint(event)
    const placement = s().placementsRef.current.find((piece) => piece.id === id)
    if (!point || !placement) return
    if (s().dragRef.current?.pointerId === GAMEPAD_POINTER) finishDrag(true)
    s().selectionRef.current = null
    s().padGroupRef.current = null
    s().padHoverRef.current = null
    s().padPointerRef.current = null
    s().interestRef.current = { x: 0, y: 0 }
    s().setPadGroup(null)
    s().setPadHoverGroup(null)
    s().setPadPointer(null)
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const memberIds = new Set(
      s()
        .placementsRef.current.filter(
          (piece) => piece.group === placement.group,
        )
        .map((piece) => piece.id),
    )
    const rect = s().viewportRef.current?.getBoundingClientRect() ?? null
    const thumb =
      rect && twoThumbNow(rect)
        ? thumbSide(event.clientX - rect.left, rect.width)
        : null
    const cruise =
      thumb !== null ||
      (event.pointerType === 'touch' &&
        window.matchMedia(MOBILE_LAYOUT).matches)
    s().dragRef.current = {
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
    otelEvent('input', 'piece.drag_start', {
      pieceId: id,
      group: placement.group,
      pointerType: event.pointerType,
      cruise,
    })
    if (cruise) a().beginCruise(event.clientX, event.clientY)
    s().setFrontGroup(placement.group)
    s().setDragGroup(placement.group)
    s().onDrag(s().placementsRef.current, placement.id)
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (s().pinchActiveRef.current) return
    const drag = s().dragRef.current
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
    if (s().dragRef.current?.cruise) a().pokeCruise()
    const currentDrag = s().dragRef.current
    if (currentDrag) syncHandover(currentDrag)
  }

  function moveDragTo(clientX: number, clientY: number): boolean {
    const drag = s().dragRef.current
    if (!drag) return false
    const point = playPoint({ clientX, clientY })
    if (!point) return false
    const rawX = point.x - drag.grabX
    const rawY = point.y - drag.grabY
    const snapped = moveDragToWorld(rawX, rawY, point.scale)
    const held = s().dragRef.current
    if (!snapped && held && held.pointerId === drag.pointerId) {
      const anchor = s().placementsRef.current.find(
        (piece) => piece.id === held.id,
      )
      if (anchor && (anchor.x !== rawX || anchor.y !== rawY)) {
        held.grabX = point.x - anchor.x
        held.grabY = point.y - anchor.y
      }
    }
    return snapped
  }

  function moveDragToWorld(rawX: number, rawY: number, scale: number): boolean {
    const drag = s().dragRef.current
    if (!drag) return false
    const clamped = clampGroup(
      s().placementsRef.current,
      drag.group,
      drag.id,
      rawX,
      rawY,
      s().layout.cellW,
      s().layout.cellH,
      s().layout.pad,
      s().area,
    )
    const moved = moveGroup(
      s().placementsRef.current,
      drag.group,
      drag.id,
      clamped.x,
      clamped.y,
    )
    const limits = approachLimits(
      Math.min(s().layout.cellW, s().layout.cellH),
      scale,
    )
    const result = pullToNeighbors(
      moved,
      drag.group,
      s().layout.cellW,
      s().layout.cellH,
      limits.highlight,
      limits.snap,
    )
    const parked = result.placements.find((piece) => piece.id === drag.id)
    // Snap adopts the neighbor group id; clamp/move must use that id.
    const liveGroup = parked?.group ?? drag.group
    if (result.snapped) drag.group = liveGroup
    const held = parked
      ? clampGroup(
          result.placements,
          liveGroup,
          drag.id,
          parked.x,
          parked.y,
          s().layout.cellW,
          s().layout.cellH,
          s().layout.pad,
          s().area,
        )
      : null
    const placements = held
      ? moveGroup(result.placements, liveGroup, drag.id, held.x, held.y)
      : result.placements
    const anchor = placements.find((piece) => piece.id === drag.id)
    if (result.snapped && anchor) {
      otelEvent('piece-logic', 'puzzle.snap', {
        pieceId: drag.id,
        group: anchor.group,
      })
      drag.group = anchor.group
    }
    s().placementsRef.current = placements
    rememberMembers(drag)
    s().setPlacements(placements)
    s().setFrontGroup(drag.group)
    if (result.snapped) {
      hapticImpact('medium')
      launchSnap(moved, placements)
      pulseGroup(drag.group)
      s().onDrag(placements, drag.id)
      if (drag.pointerId === GAMEPAD_POINTER) {
        s().padGroupRef.current = drag.group
        s().setPadGroup(drag.group)
        s().setNear(null)
        return false
      }
      finishDrag(true)
      return true
    }
    s().setNear(result.near)
    s().onDrag(placements, drag.id)
    return false
  }
  return {
    present,
    commitView,
    playPoint,
    publishPointer,
    finishDrag,
    rememberMembers,
    beginSlide,
    launchSnap,
    pulseGroup,
    twoThumbNow,
    clearHandover,
    syncHandover,
    showCruiseStick,
    cruiseStickView,
    publishPanStick,
    pokeStickPan,
    stickPanTick,
    lockHeldPiece,
    endPan,
    stopPan,
    onViewportPointerDown,
    onViewportPointerMove,
    onViewportPointerMoveCapture,
    onPointerDown,
    onPointerMove,
    moveDragTo,
    moveDragToWorld,
  }
}
