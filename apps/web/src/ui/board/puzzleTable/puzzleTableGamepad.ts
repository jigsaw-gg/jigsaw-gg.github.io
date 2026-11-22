import { GAMEPAD_POINTER } from '../../../input/dualshock.ts'
import { getState as getGamepadState } from '../../../input/gamepadHandler.ts'
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
} from '../../../input/gamepadView.ts'
import { cameraLimits, zoomCamera } from '../../../world/placement.ts'
import { GAMEPAD_BLINK_MS, GAMEPAD_RELEASE_S } from './puzzleTableShared.ts'
import type {
  PuzzleTableActions,
  PuzzleTableInputState,
} from './puzzleTableInputState.ts'

export type PuzzleTableGamepadActions = Pick<
  PuzzleTableActions,
  | 'viewportSize'
  | 'cameraForViewport'
  | 'revealGroup'
  | 'clearPadSelection'
  | 'selectHoveredPad'
  | 'syncPadPointer'
  | 'hoverJump'
  | 'beginGamepadDrag'
  | 'moveDragBy'
  | 'gamepadTick'
>

export function createPuzzleTableGamepad(
  s: () => PuzzleTableInputState,
  a: () => PuzzleTableActions,
): PuzzleTableGamepadActions {
  function viewportSize(): { width: number; height: number } | null {
    const viewport = s().viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return null
    return { width: rect.width, height: rect.height }
  }

  function cameraForViewport(width: number, height: number) {
    return cameraLimits(
      width,
      height,
      s().area,
      Math.min(s().layout.cellW, s().layout.cellH),
    )
  }

  function revealGroup(group: string) {
    const size = viewportSize()
    const follow = s().followRef.current
    if (!size || !follow) return
    if (
      piecesVisible(
        follow,
        size.width,
        size.height,
        s().placementsRef.current,
        s().layout.cellW,
        s().layout.cellH,
      )
    ) {
      return
    }
    const bounds = groupWorldBounds(
      s().placementsRef.current,
      group,
      s().layout.cellW,
      s().layout.cellH,
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
    s().userAdjustedRef.current = true
    a().commitView(next)
  }

  function clearPadSelection() {
    if (s().dragRef.current?.pointerId === GAMEPAD_POINTER) a().finishDrag(true)
    s().selectionRef.current = null
    s().padGroupRef.current = null
    s().interestRef.current = { x: 0, y: 0 }
    s().setPadGroup(null)
    const follow = s().followRef.current
    if (
      follow.zoom !== s().viewRef.current.zoom ||
      follow.x !== s().viewRef.current.x ||
      follow.y !== s().viewRef.current.y
    ) {
      s().viewRef.current = follow
      s().setView(follow)
    }
  }

  function selectHoveredPad(id: string) {
    const existing = s().dragRef.current
    if (existing && existing.pointerId !== GAMEPAD_POINTER) {
      return
    }
    if (s().dragRef.current?.pointerId === GAMEPAD_POINTER) a().finishDrag(true)
    const placement = s().placementsRef.current.find((piece) => piece.id === id)
    if (!placement) return
    s().selectionRef.current = placement.id
    s().padGroupRef.current = placement.group
    s().setPadGroup(placement.group)
    s().setFrontGroup(placement.group)
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
    const prev = s().padPointerRef.current
    const prevHover = s().padHoverRef.current
    s().padPointerRef.current = next
    s().padHoverRef.current = hover
    s().padHoverIdRef.current = hoverId
    if (
      (next === null) !== (prev === null) ||
      (next !== null &&
        prev !== null &&
        (Math.abs(next.x - prev.x) > 0.5 || Math.abs(next.y - prev.y) > 0.5))
    ) {
      s().setPadPointer(next)
    }
    if (hover !== prevHover) s().setPadHoverGroup(hover)
  }

  /** Move the hover pointer onto a group in a screen direction (D-pad). */
  function hoverJump(
    direction: PadDirection,
    size: { width: number; height: number },
  ): void {
    const follow = s().followRef.current
    const current = s().padHoverRef.current
    const from = (current
      ? groupScreenCenter(
          s().placementsRef.current,
          current,
          s().layout.cellW,
          s().layout.cellH,
          follow,
        )
      : null) ??
      s().padPointerRef.current ?? {
        x: size.width / 2,
        y: size.height / 2,
      }
    const next = pickGroupInDirection(
      s().placementsRef.current,
      s().layout.cellW,
      s().layout.cellH,
      follow,
      from,
      current,
      direction,
    )
    if (!next) return
    const placement = s().placementsRef.current.find(
      (piece) => piece.id === next.id,
    )
    if (!placement) return
    revealGroup(next.group)
    const camera = s().followRef.current
    const zoom = camera.zoom > 0 ? camera.zoom : 1
    const bounds = groupWorldBounds(
      s().placementsRef.current,
      next.group,
      s().layout.cellW,
      s().layout.cellH,
    )
    const worldX = bounds
      ? (bounds.minX + bounds.maxX) / 2
      : placement.x + s().layout.cellW / 2
    const worldY = bounds
      ? (bounds.minY + bounds.maxY) / 2
      : placement.y + s().layout.cellH / 2
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
    const placement = s().placementsRef.current.find((piece) => piece.id === id)
    if (!placement) return false
    const existing = s().dragRef.current
    if (existing?.pointerId === GAMEPAD_POINTER) {
      if (existing.id === id) return true
      a().finishDrag(true)
    } else if (existing) {
      return false
    }
    const memberIds = new Set(
      s()
        .placementsRef.current.filter(
          (piece) => piece.group === placement.group,
        )
        .map((piece) => piece.id),
    )
    s().dragRef.current = {
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
    s().padGroupRef.current = placement.group
    s().setPadGroup(placement.group)
    s().setFrontGroup(placement.group)
    s().setDragGroup(placement.group)
    s().onDrag(s().placementsRef.current, placement.id)
    return true
  }

  function moveDragBy(
    dx: number,
    dy: number,
  ): { dx: number; dy: number } | null {
    const drag = s().dragRef.current
    if (!drag || drag.pointerId !== GAMEPAD_POINTER) return null
    const before = s().placementsRef.current.find(
      (piece) => piece.id === drag.id,
    )
    if (!before) return null
    const scale = s().viewRef.current.zoom > 0 ? s().viewRef.current.zoom : 1
    a().moveDragToWorld(before.x + dx, before.y + dy, scale)
    const held = s().dragRef.current
    if (!held || held.pointerId !== GAMEPAD_POINTER) return null
    const after = s().placementsRef.current.find(
      (piece) => piece.id === held.id,
    )
    if (!after) return null
    return { dx: after.x - before.x, dy: after.y - before.y }
  }

  function gamepadTick(now: number) {
    const clock = s().padClockRef.current
    const dt =
      clock.last === 0
        ? 0
        : Math.min(0.05, Math.max(0, (now - clock.last) / 1000))
    clock.last = now
    const { pad, reading, receiving } = getGamepadState()
    const connected = pad !== null
    if (connected !== s().connectedRef.current) {
      s().connectedRef.current = connected
      s().setGamepadConnected(connected)
      if (!connected && s().helpOpenRef.current) {
        s().helpOpenRef.current = false
        s().setGamepadHelpOpen(false)
      }
    }
    if (receiving && !clock.latched) {
      clock.latched = true
      clock.showUntil = now + GAMEPAD_BLINK_MS
    }
    if (!receiving && now >= clock.showUntil) clock.latched = false
    const show = now < clock.showUntil
    if (show !== s().blinkRef.current) {
      s().blinkRef.current = show
      s().setGamepadBlink(show)
    }
    if (s().boardLockedRef.current) {
      if (s().dragRef.current?.pointerId === GAMEPAD_POINTER)
        a().finishDrag(true)
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
      if (s().dragRef.current?.pointerId === GAMEPAD_POINTER)
        a().finishDrag(true)
      syncPadPointer(null, null)
      const interest = s().interestRef.current
      if (interest.x !== 0 || interest.y !== 0) {
        s().interestRef.current = { x: 0, y: 0 }
        const follow = s().followRef.current
        if (
          follow.zoom !== s().viewRef.current.zoom ||
          follow.x !== s().viewRef.current.x ||
          follow.y !== s().viewRef.current.y
        ) {
          s().viewRef.current = follow
          s().setView(follow)
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
      const next = !s().helpOpenRef.current
      s().helpOpenRef.current = next
      s().setGamepadHelpOpen(next)
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
    let follow = s().followRef.current
    const limits = cameraForViewport(size.width, size.height)
    const pull = reading.l2 - reading.r2
    if (pull !== 0 && follow.zoom > 0) {
      const selectedPiece = s().selectionRef.current
        ? s().placementsRef.current.find(
            (piece) => piece.id === s().selectionRef.current,
          )
        : undefined
      const bounds = selectedPiece
        ? groupWorldBounds(
            s().placementsRef.current,
            selectedPiece.group,
            s().layout.cellW,
            s().layout.cellH,
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

    if (!s().selectionRef.current) {
      s().interestRef.current = { x: 0, y: 0 }
      if (rightX !== 0 || rightY !== 0) {
        follow = {
          ...follow,
          x: follow.x - rightX * PAN_SPEED_PX * dt,
          y: follow.y - rightY * PAN_SPEED_PX * dt,
        }
      }
      if (dpadDirection) {
        hoverJump(dpadDirection, size)
        follow = s().followRef.current
      } else {
        let pointer = s().padPointerRef.current
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
          s().placementsRef.current,
          worldX,
          worldY,
          s().layout.cellW,
          s().layout.cellH,
          s().padHoverRef.current,
        )
        syncPadPointer(pointer, hit?.group ?? null, hit?.id ?? null)
      }
      const hoverPick = s().padHoverIdRef.current
      if (l1Edge && hoverPick) {
        selectHoveredPad(hoverPick)
      }
      s().followRef.current = follow
      if (
        follow.zoom !== s().viewRef.current.zoom ||
        follow.x !== s().viewRef.current.x ||
        follow.y !== s().viewRef.current.y
      ) {
        s().userAdjustedRef.current = true
        s().viewRef.current = follow
        s().setView(follow)
      }
      return
    }

    if (l1Edge) clearPadSelection()
    syncPadPointer(null, null, null)
    const fitAll = piecesVisible(
      follow,
      size.width,
      size.height,
      s().placementsRef.current,
      s().layout.cellW,
      s().layout.cellH,
    )
    const moving = leftX !== 0 || leftY !== 0
    if (moving && s().selectionRef.current) {
      clock.idle = 0
      if (!fitAll) {
        const held = s().placementsRef.current.find(
          (piece) => piece.id === s().selectionRef.current,
        )
        const bounds = held
          ? groupWorldBounds(
              s().placementsRef.current,
              held.group,
              s().layout.cellW,
              s().layout.cellH,
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
      const selectedId = s().selectionRef.current
      if (selectedId && beginGamepadDrag(selectedId)) {
        const shownZoom =
          s().viewRef.current.zoom > 0 ? s().viewRef.current.zoom : 1
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
    } else if (s().dragRef.current?.pointerId === GAMEPAD_POINTER) {
      clock.idle += dt
      if (clock.idle >= GAMEPAD_RELEASE_S) {
        a().finishDrag(true)
        clock.idle = 0
      }
    }

    const look = !fitAll
      ? lookOffset(rightX, rightY, size.width, size.height, follow.zoom)
      : { x: 0, y: 0 }
    s().interestRef.current = look
    s().followRef.current = follow
    const shown = a().present(follow)
    if (
      shown.zoom === s().viewRef.current.zoom &&
      shown.x === s().viewRef.current.x &&
      shown.y === s().viewRef.current.y
    ) {
      return
    }
    s().userAdjustedRef.current = true
    s().viewRef.current = shown
    s().setView(shown)
  }
  return {
    viewportSize,
    cameraForViewport,
    revealGroup,
    clearPadSelection,
    selectHoveredPad,
    syncPadPointer,
    hoverJump,
    beginGamepadDrag,
    moveDragBy,
    gamepadTick,
  }
}
