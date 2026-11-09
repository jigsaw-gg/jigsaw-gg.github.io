/**
 * Continuous Gamepad polling, matching Slither's gamepadHandler:
 * start once at app install, poll navigator.getGamepads()[0] every rAF,
 * and restart on gamepadconnected.
 */

import {
  type SonyReading,
  gamepadBusy,
  hasStickAxes,
  readStandardSony,
} from './dualshock.ts'

export interface GamepadHandlerState {
  reading: SonyReading | null
  receiving: boolean
  debugInfo: string
  pad: Gamepad | null
}

const ZERO: GamepadHandlerState = {
  reading: null,
  receiving: false,
  debugInfo: '',
  pad: null,
}

let state: GamepadHandlerState = { ...ZERO }
let rafId: number | null = null
let backupId = 0
let lastDiag = ''
const listeners = new Set<(state: GamepadHandlerState) => void>()

function formatDebug(pad: Gamepad, reading: SonyReading | null): string {
  const axes = pad.axes ?? []
  const right = reading?.right ?? { x: 0, y: 0 }
  return (
    `Gamepad[${pad.index}]: ${pad.id || 'unknown'} | mapping=${JSON.stringify(pad.mapping)} | ` +
    `${pad.buttons?.length ?? 0} btn, ${axes.length} axes | ` +
    `R-stick: (${right.x.toFixed(2)}, ${right.y.toFixed(2)})`
  )
}

function publish(next: GamepadHandlerState): void {
  state = next
  for (const listener of listeners) listener(state)
}

function updateLoop(): void {
  window.clearTimeout(backupId)
  if (typeof navigator === 'undefined' || !navigator.getGamepads) {
    publish({ ...ZERO, debugInfo: 'getGamepads missing' })
    schedule()
    return
  }

  const pads = navigator.getGamepads()
  // Slither only ever reads slot 0. Prefer that when present.
  let pad = pads[0] ?? null
  if (!pad || !hasStickAxes(pad)) {
    pad = null
    for (let index = 1; index < pads.length; index += 1) {
      const candidate = pads[index]
      if (candidate && hasStickAxes(candidate)) {
        pad = candidate
        break
      }
    }
  }

  if (!pad) {
    lastDiag = ''
    publish({ ...ZERO })
    schedule()
    return
  }

  const reading = readStandardSony(pad)
  const receiving = gamepadBusy(pad)
  const debugInfo = import.meta.env.DEV ? formatDebug(pad, reading) : ''
  publish({
    pad,
    reading,
    receiving,
    debugInfo,
  })
  if (import.meta.env.DEV && reading) {
    const diag =
      `cross=${reading.cross ? 1 : 0} triangle=${reading.triangle ? 1 : 0} ` +
      `l1=${reading.l1 ? 1 : 0} r1=${reading.r1 ? 1 : 0} ` +
      `dpad=${reading.up ? 'U' : ''}${reading.down ? 'D' : ''}${reading.leftPad ? 'L' : ''}${reading.rightPad ? 'R' : '-'} ` +
      `l2=${reading.l2.toFixed(2)} r2=${reading.r2.toFixed(2)} ` +
      `left=${reading.left.x.toFixed(2)},${reading.left.y.toFixed(2)} ` +
      `right=${reading.right.x.toFixed(2)},${reading.right.y.toFixed(2)} ` +
      `busy=${receiving ? 1 : 0}`
    if (diag !== lastDiag) {
      lastDiag = diag
      console.log(`gamepad reading: ${diag}`)
    }
  }
  schedule()
}

function schedule(): void {
  rafId = requestAnimationFrame(updateLoop)
  // Cursor's embedded browser can stall rAF; keep a backup tick.
  backupId = window.setTimeout(() => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    updateLoop()
  }, 50)
}

/** Start the rAF polling loop. Safe to call more than once. */
export function start(): void {
  if (rafId !== null) return
  updateLoop()
}

export function stop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  window.clearTimeout(backupId)
  backupId = 0
  publish({ ...ZERO })
}

export function getState(): GamepadHandlerState {
  return state
}

export function subscribe(
  listener: (state: GamepadHandlerState) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Install once: start polling and restart when a pad connects. */
export function install(): void {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return
  start()
  window.addEventListener('gamepadconnected', start)
}
