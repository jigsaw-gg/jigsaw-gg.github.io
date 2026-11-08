/**
 * Touch drag along a screen or canvas edge scrolls the table under the piece.
 *
 * The finger picks a target direction and a target speed (closer to the rim
 * is faster). A capped engine approaches that speed, and the throttle itself
 * fades in and out, so landing on the rim does not lurch.
 *
 * Heading works like a bicycle. A small aim change arcs at speed. A sharp
 * one sheds speed first, because the wheel cannot snap around, then turns.
 */

export const CRUISE_MAX_SPEED = 860

const ENGINE_POWER = 2400
const BRAKE_POWER = 3000
const ACCEL_TAU = 0.14
const SPEED_RESPONSE = 5.5
const SHARP_FROM = (18 * Math.PI) / 180
const SHARP_TO = (100 * Math.PI) / 180
const YAW_GENTLE = 4.2
const YAW_SHARP = 0.7
const LATERAL_GENTLE = 4600
const LATERAL_SHARP = 820
const STOPPED = 18

export interface CruiseBody {
  speed: number
  heading: number
  accel: number
}

export interface EdgePull {
  x: number
  y: number
  speed: number
}

export interface EdgeBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function createCruise(): CruiseBody {
  return { speed: 0, heading: 0, accel: 0 }
}

export function cruiseMargin(width: number, height: number): number {
  const shorter = Math.min(Math.abs(width), Math.abs(height))
  return clamp(shorter * 0.2, 56, 168)
}

/**
 * Table travel that would bring more board in from the near edges.
 * Left rim scrolls the table right, top rim scrolls it down.
 */
export function edgePull(
  touchX: number,
  touchY: number,
  bounds: EdgeBounds,
  margin: number,
  maxSpeed: number,
): EdgePull {
  const left = rim(touchX - bounds.left, margin)
  const right = rim(bounds.right - touchX, margin)
  const top = rim(touchY - bounds.top, margin)
  const bottom = rim(bounds.bottom - touchY, margin)
  const x = left - right
  const y = top - bottom
  const mag = Math.hypot(x, y)
  if (mag < 1e-4 || maxSpeed <= 0) return { x: 0, y: 0, speed: 0 }
  const strength = Math.min(1, mag)
  return { x: x / mag, y: y / mag, speed: strength * maxSpeed }
}

export function stepCruise(
  body: CruiseBody,
  pull: EdgePull,
  dt: number,
): CruiseBody {
  const step = Math.min(Math.max(dt, 0), 0.05)
  if (step === 0) return body
  let { speed, heading, accel } = body
  let desired = 0
  if (pull.speed > 0) {
    const aim = Math.atan2(pull.y, pull.x)
    if (speed < STOPPED) {
      heading = aim
      desired = pull.speed
    } else {
      const error = wrap(aim - heading)
      const sharp = smoothstep(SHARP_FROM, SHARP_TO, Math.abs(error))
      desired = pull.speed * (1 - 0.92 * sharp)
      const yawCap = YAW_GENTLE + (YAW_SHARP - YAW_GENTLE) * sharp
      const lateral = LATERAL_GENTLE + (LATERAL_SHARP - LATERAL_GENTLE) * sharp
      const yaw = Math.min(yawCap, lateral / Math.max(speed, 70))
      heading += clamp(error, -yaw * step, yaw * step)
    }
  }
  if (desired === 0 && speed < 0.8 && Math.abs(accel) < 8) {
    return { speed: 0, heading, accel: 0 }
  }
  const needed = clamp(
    (desired - speed) * SPEED_RESPONSE,
    -BRAKE_POWER,
    ENGINE_POWER,
  )
  const blend = 1 - Math.exp(-step / ACCEL_TAU)
  accel += (needed - accel) * blend
  const driven = speed + accel * step
  const crossed = desired > 0 && (speed - desired) * (driven - desired) < 0
  if (crossed) {
    speed = desired + (driven - desired) * 0.35
    accel *= 0.45
  } else {
    speed = Math.max(0, driven)
  }
  return { speed, heading, accel }
}

export function cruiseVelocity(body: CruiseBody): { x: number; y: number } {
  return {
    x: Math.cos(body.heading) * body.speed,
    y: Math.sin(body.heading) * body.speed,
  }
}

/** Zoom falls as cruise speed rises, and returns to `baseZoom` as it stops. */
export function cruiseZoom(
  baseZoom: number,
  speed: number,
  maxSpeed: number,
  minZoom: number,
  enabled: boolean,
): number {
  if (!enabled || maxSpeed <= 0 || !(baseZoom > 0)) return baseZoom
  const t = clamp(speed / maxSpeed, 0, 1)
  const amount = t * t * (3 - 2 * t)
  const floor = Math.min(baseZoom, Math.max(minZoom, baseZoom * 0.45))
  return baseZoom - (baseZoom - floor) * 0.72 * amount
}

function rim(distance: number, margin: number): number {
  if (margin <= 0) return distance <= 0 ? 1 : 0
  if (distance >= margin) return 0
  const t = 1 - clamp(distance / margin, 0, 1)
  return t * t * (3 - 2 * t)
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function wrap(rad: number): number {
  const turn = Math.PI * 2
  let angle = (rad + Math.PI) % turn
  if (angle < 0) angle += turn
  return angle - Math.PI
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
