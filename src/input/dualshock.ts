/** Standard mapping: Cross/A, L1, R1, L2, R2, D-pad. Sticks are axes 0–3. */
const BUTTON_CROSS = 0
const BUTTON_L1 = 4
const BUTTON_R1 = 5
const BUTTON_L2 = 6
const BUTTON_R2 = 7
const BUTTON_UP = 12
const BUTTON_DOWN = 13
const BUTTON_LEFT = 14
const BUTTON_RIGHT = 15

/** DualShock 4 often rests near |axis|≈0.25–0.33 on Chrome; 0.18 still counts as look. */
const STICK_DEADZONE = 0.36
const TRIGGER_IDLE = 0.12

const SONY_ID = /dualshock|dualsense|sony|vendor:\s*054c|\b054c\b|54c-/i

export const GAMEPAD_POINTER = -1

export interface PadAxes {
  x: number
  y: number
}

export interface SonyReading {
  left: PadAxes
  right: PadAxes
  /** Cross (PS) / A (Xbox) — confirm / click. */
  cross: boolean
  l1: boolean
  r1: boolean
  l2: number
  r2: number
  up: boolean
  down: boolean
  leftPad: boolean
  rightPad: boolean
}

export function isSonyGamepad(id: string): boolean {
  return SONY_ID.test(id)
}

/** Radial dead zone, then rescale so the rim is still full deflection. */
export function stickAxes(x: number, y: number): PadAxes {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 }
  const mag = Math.hypot(x, y)
  if (mag < STICK_DEADZONE) return { x: 0, y: 0 }
  const scaled = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE))
  const gain = scaled / mag
  return { x: x * gain, y: y * gain }
}

function triggerValue(pad: Gamepad, index: number): number {
  const button = pad.buttons?.[index]?.value
  const axes = pad.axes
  const axis =
    (button === undefined || button === null) && axes && axes.length > 5
      ? (Number(axes[index - 2]) + 1) / 2
      : 0
  const value = button ?? axis
  if (!Number.isFinite(value) || value < TRIGGER_IDLE) return 0
  return Math.min(1, value)
}

/**
 * A connected pad with the four stick axes. Chrome often reports a DualShock
 * as "Wireless Controller" with an empty mapping string, while the buttons
 * and axes still follow the standard order.
 */
export function hasStickAxes(pad: Gamepad): boolean {
  return pad.connected && (pad.axes?.length ?? 0) > 3
}

export function readStandardSony(pad: Gamepad): SonyReading | null {
  if (!hasStickAxes(pad)) return null
  return {
    left: stickAxes(pad.axes[0] ?? 0, pad.axes[1] ?? 0),
    right: stickAxes(pad.axes[2] ?? 0, pad.axes[3] ?? 0),
    cross: pad.buttons?.[BUTTON_CROSS]?.pressed ?? false,
    l1: pad.buttons?.[BUTTON_L1]?.pressed ?? false,
    r1: pad.buttons?.[BUTTON_R1]?.pressed ?? false,
    l2: triggerValue(pad, BUTTON_L2),
    r2: triggerValue(pad, BUTTON_R2),
    up: pad.buttons?.[BUTTON_UP]?.pressed ?? false,
    down: pad.buttons?.[BUTTON_DOWN]?.pressed ?? false,
    leftPad: pad.buttons?.[BUTTON_LEFT]?.pressed ?? false,
    rightPad: pad.buttons?.[BUTTON_RIGHT]?.pressed ?? false,
  }
}

export function gamepadBusy(pad: Gamepad): boolean {
  for (const button of pad.buttons ?? []) {
    if (button.pressed || button.value > TRIGGER_IDLE) return true
  }
  for (const axis of pad.axes ?? []) {
    if (Number.isFinite(axis) && Math.abs(axis) > STICK_DEADZONE) return true
  }
  return false
}

/** Prefer slot 0 like Slither; otherwise the first stick pad. */
export function connectedPad(pads: ArrayLike<Gamepad | null>): Gamepad | null {
  const first = pads[0]
  if (first && hasStickAxes(first)) return first
  for (let index = 1; index < pads.length; index += 1) {
    const pad = pads[index]
    if (pad && hasStickAxes(pad)) return pad
  }
  return null
}

export function sonyPadsReceiving(pads: ArrayLike<Gamepad | null>): boolean {
  const pad = connectedPad(pads)
  return pad !== null && gamepadBusy(pad)
}

/** The pad in the first slot, or a Sony pad when one is also connected. */
export function readActiveSony(
  pads: ArrayLike<Gamepad | null>,
): SonyReading | null {
  const pad = connectedPad(pads)
  return pad ? readStandardSony(pad) : null
}
