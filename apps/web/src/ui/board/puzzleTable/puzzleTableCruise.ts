import { isExpanded } from '../../../fullscreen.ts'
import {
  CRUISE_MAX_SPEED,
  createCruise,
  cruiseMargin,
  cruiseVelocity,
  cruiseZoom,
  edgePull,
  stepCruise,
} from './edgeCruise.ts'
import {
  cameraLimits,
  zoomCamera,
  type Camera,
} from '../../../world/placement.ts'
import { halfEdgeBounds } from './twoThumb.ts'
import {
  allowsMotion,
  cruiseLive,
  touchEdgeBounds,
  type ActiveCruise,
} from './puzzleTableShared.ts'
import type {
  PuzzleTableActions,
  PuzzleTableInputState,
} from './puzzleTableInputState.ts'

export type PuzzleTableCruiseActions = Pick<
  PuzzleTableActions,
  'beginCruise' | 'pokeCruise' | 'cruiseTick' | 'easeCruiseZoom'
>

export function createPuzzleTableCruise(
  s: () => PuzzleTableInputState,
  a: () => PuzzleTableActions,
): PuzzleTableCruiseActions {
  function beginCruise(clientX: number, clientY: number) {
    const viewport = s().viewportRef.current
    const current = s().viewRef.current
    if (!viewport || !current) return
    const rect = viewport.getBoundingClientRect()
    const previous = s().cruiseRef.current
    s().cruiseRef.current = {
      body: createCruise(),
      baseZoom: previous?.baseZoom ?? current.zoom,
      anchorX: clientX - rect.left,
      anchorY: clientY - rect.top,
      lastTime: 0,
    }
    pokeCruise()
  }

  function pokeCruise() {
    if (s().cruiseFrameRef.current !== 0) return
    s().cruiseFrameRef.current = requestAnimationFrame((now) => {
      s().cruiseTickRef.current(now)
    })
  }

  function cruiseTick(now: number) {
    s().cruiseFrameRef.current = 0
    s().interestRef.current = { x: 0, y: 0 }
    const cruise = s().cruiseRef.current
    if (!cruise || s().pinchActiveRef.current) {
      s().cruiseRef.current = null
      a().showCruiseStick(null)
      return
    }
    // A direct grab of the table cancels edge cruise. A thumb stick keeps
    // the held piece and takes the camera for itself.
    const pan = s().panRef.current
    if (pan && !pan.stick) {
      s().cruiseRef.current = null
      a().showCruiseStick(null)
      return
    }
    const viewport = s().viewportRef.current
    const current = s().viewRef.current
    if (!viewport || !current) return
    if (cruise.lastTime === 0) {
      cruise.lastTime = now
      pokeCruise()
      return
    }
    const dt = Math.min(0.05, Math.max(0, (now - cruise.lastTime) / 1000))
    cruise.lastTime = now
    const drag = s().dragRef.current
    const stickOwnsCamera = s().panRef.current?.stick === true
    if (stickOwnsCamera) {
      cruise.body = { speed: 0, heading: cruise.body.heading, accel: 0 }
    }
    if (!drag?.cruise || stickOwnsCamera) {
      a().showCruiseStick(null)
      if (drag?.cruise && stickOwnsCamera) {
        pokeCruise()
        return
      }
      if (easeCruiseZoom(cruise, current, viewport, dt)) {
        s().cruiseRef.current = null
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
    a().showCruiseStick(a().cruiseStickView(drag, rect, pull))
    const body = stepCruise(cruise.body, pull, dt)
    cruise.body = body
    const velocity = cruiseVelocity(body)
    const limits = cameraLimits(
      rect.width,
      rect.height,
      s().area,
      Math.min(s().layout.cellW, s().layout.cellH),
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
    s().interestRef.current = { x: 0, y: 0 }
    s().followRef.current = next
    s().viewRef.current = next
    a().moveDragTo(drag.clientX, drag.clientY)
    const held = s().dragRef.current
    if (held?.cruise) {
      const anchor = s().placementsRef.current.find(
        (piece) => piece.id === held.id,
      )
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
    s().userAdjustedRef.current = true
    s().followRef.current = next
    s().viewRef.current = next
    s().setView(next)
    a().publishPointer(drag.clientX, drag.clientY)
    if (s().dragRef.current?.cruise) {
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
      s().area,
      Math.min(s().layout.cellW, s().layout.cellH),
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
    s().userAdjustedRef.current = true
    a().commitView(next)
    return Math.abs(goal - next.zoom) < 0.002
  }
  return {
    beginCruise,
    pokeCruise,
    cruiseTick,
    easeCruiseZoom,
  }
}
