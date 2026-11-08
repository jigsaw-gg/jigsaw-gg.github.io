/**
 * Page-level gamepad UI: D-pad moves focus between controls, Cross (X/A)
 * activates the focused control (Create/Start, Play, links, …).
 * Disabled while the puzzle board owns the pad (.play-mode active).
 */

import {
  pickScreenTargetInDirection,
  type PadDirection,
} from '../puzzle/gamepadView.ts'
import { getState, subscribe } from './gamepadHandler.ts'

const FOCUS_CLASS = 'gamepad-focused'
const SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let installed = false
let focused: HTMLElement | null = null
const held = {
  up: false,
  down: false,
  leftPad: false,
  rightPad: false,
  cross: false,
}

/** True when the puzzle board is in play and should keep D-pad / Cross. */
export function playBoardOwnsPad(): boolean {
  return Boolean(document.querySelector('.play-mode:not(.play-mode--inactive)'))
}

export function installGamepadUiNav(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  subscribe(onPad)
  document.addEventListener('focusin', onFocusIn)
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (target.closest('.play-mode')) return
  markFocused(target)
}

function onPad(): void {
  const reading = getState().reading
  if (!reading || playBoardOwnsPad()) {
    held.up = reading?.up ?? false
    held.down = reading?.down ?? false
    held.leftPad = reading?.leftPad ?? false
    held.rightPad = reading?.rightPad ?? false
    held.cross = reading?.cross ?? false
    return
  }

  const upEdge = reading.up && !held.up
  const downEdge = reading.down && !held.down
  const leftEdge = reading.leftPad && !held.leftPad
  const rightEdge = reading.rightPad && !held.rightPad
  const crossEdge = reading.cross && !held.cross
  held.up = reading.up
  held.down = reading.down
  held.leftPad = reading.leftPad
  held.rightPad = reading.rightPad
  held.cross = reading.cross

  const direction: PadDirection | null = rightEdge
    ? 'right'
    : leftEdge
      ? 'left'
      : downEdge
        ? 'down'
        : upEdge
          ? 'up'
          : null

  if (direction) moveFocus(direction)
  if (crossEdge) activateFocused()
}

function listFocusables(): HTMLElement[] {
  const nodes = document.querySelectorAll(SELECTOR)
  const out: HTMLElement[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const el = nodes[index]
    if (!(el instanceof HTMLElement)) continue
    if (!isUiFocusable(el)) continue
    out.push(el)
  }
  return out
}

function isUiFocusable(el: HTMLElement): boolean {
  if (el.closest('.play-mode')) return false
  if (el.closest('[hidden]')) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (Number(style.opacity) === 0) return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false
  if (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  ) {
    return false
  }
  return true
}

function moveFocus(direction: PadDirection): void {
  const targets = listFocusables()
  if (targets.length === 0) return

  const current =
    focused && targets.includes(focused)
      ? focused
      : document.activeElement instanceof HTMLElement &&
          targets.includes(document.activeElement)
        ? document.activeElement
        : null

  const from = current
    ? centerOf(current)
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 }

  const candidates = targets.map((el) => {
    const point = centerOf(el)
    return { id: el, x: point.x, y: point.y }
  })

  let next = pickScreenTargetInDirection(candidates, from, current, direction)
  if (!next) {
    next =
      targets.find((el) => el.classList.contains('button--primary')) ??
      targets.find((el) => el.matches('button[type="submit"], .button')) ??
      targets[0] ??
      null
  }
  if (next) focusElement(next)
}

function activateFocused(): void {
  const targets = listFocusables()
  let el =
    focused && targets.includes(focused)
      ? focused
      : document.activeElement instanceof HTMLElement &&
          targets.includes(document.activeElement)
        ? document.activeElement
        : null
  if (!el) {
    el =
      targets.find((item) => item.classList.contains('button--primary')) ??
      targets.find((item) => item.matches('button[type="submit"]')) ??
      null
  }
  if (!el) return
  focusElement(el)
  if (import.meta.env.DEV) {
    console.log(
      `gamepad ui: activate ${el.tagName.toLowerCase()} ${el.className}`,
    )
  }
  el.click()
}

function focusElement(el: HTMLElement): void {
  markFocused(el)
  try {
    el.focus({ preventScroll: false })
  } catch {
    el.focus()
  }
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function markFocused(el: HTMLElement): void {
  if (focused && focused !== el) focused.classList.remove(FOCUS_CLASS)
  focused = el
  el.classList.add(FOCUS_CLASS)
}

function centerOf(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
