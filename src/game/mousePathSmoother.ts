/**
 * Presentation-only path for remote held pieces / cursors.
 *
 * Server ticks are ~10 Hz absolute poses; this fakes a human mouse: soft
 * ease-in, steady cruise, curved soft turns, and stop→restart on sharp turns.
 * Catch-up speed scales with lag and observed target speed so fast remotes do
 * not trail behind at a capped crawl.
 * Not authoritative — resting board + release still come from the server.
 */

export type MousePathSmootherOptions = {
  /** Soft cruise when nearly caught up (px/s). */
  cruiseSpeed: number
  /** Hard ceiling (px/s), high enough for flick catch-up. */
  maxSpeed: number
  /** Close remaining gap in about this many seconds. */
  catchUpSec: number
  accel: number
  brake: number
  /** Stronger accel when far behind the target. */
  catchUpAccel: number
}

const DEFAULTS: MousePathSmootherOptions = {
  cruiseSpeed: 1400,
  maxSpeed: 10_000,
  catchUpSec: 0.09,
  accel: 5200,
  brake: 7800,
  catchUpAccel: 28_000,
}

/** Dot(velocity, desired) below this ⇒ sharp turn (≈100°). */
const SHARP_TURN_DOT = -0.15
const ARRIVE_RADIUS_PX = 22
const SNAP_RADIUS_PX = 1.25
const MIN_SPEED_PX_S = 12
const CATCH_UP_DIST_PX = 64

export class MousePathSmoother {
  private readonly options: MousePathSmootherOptions
  private x = 0
  private y = 0
  private vx = 0
  private vy = 0
  private tx = 0
  private ty = 0
  private hasPose = false
  private brakingForTurn = false
  private lastTargetAt = 0
  private targetSpeed = 0

  constructor(options: Partial<MousePathSmootherOptions> = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  reset(): void {
    this.x = 0
    this.y = 0
    this.vx = 0
    this.vy = 0
    this.tx = 0
    this.ty = 0
    this.hasPose = false
    this.brakingForTurn = false
    this.lastTargetAt = 0
    this.targetSpeed = 0
  }

  /** Latest absolute world target from a Tick pose. */
  setTarget(x: number, y: number, nowMs = performance.now()): void {
    if (this.hasPose && this.lastTargetAt > 0) {
      const dt = (nowMs - this.lastTargetAt) / 1000
      if (dt > 0.001 && dt < 0.5) {
        this.targetSpeed = Math.hypot(x - this.tx, y - this.ty) / dt
      }
    }
    this.tx = x
    this.ty = y
    this.lastTargetAt = nowMs
    if (!this.hasPose) {
      this.x = x
      this.y = y
      this.vx = 0
      this.vy = 0
      this.hasPose = true
      this.brakingForTurn = false
      this.targetSpeed = 0
    }
  }

  /** Advance simulation; returns current display pose, or null if unset. */
  step(dtSec: number): { x: number; y: number } | null {
    if (!this.hasPose) return null
    const dt = Math.min(0.05, Math.max(0, dtSec))
    if (dt <= 0) return { x: this.x, y: this.y }

    const { cruiseSpeed, maxSpeed, catchUpSec, accel, brake, catchUpAccel } =
      this.options

    const dx = this.tx - this.x
    const dy = this.ty - this.y
    const dist = Math.hypot(dx, dy)
    if (dist <= SNAP_RADIUS_PX) {
      this.x = this.tx
      this.y = this.ty
      this.vx = 0
      this.vy = 0
      this.brakingForTurn = false
      return { x: this.x, y: this.y }
    }

    const desiredX = dx / dist
    const desiredY = dy / dist
    const speed = Math.hypot(this.vx, this.vy)

    if (speed > MIN_SPEED_PX_S) {
      const hx = this.vx / speed
      const hy = this.vy / speed
      const align = hx * desiredX + hy * desiredY
      if (align < SHARP_TURN_DOT) this.brakingForTurn = true
      else if (align > 0.35) this.brakingForTurn = false
    } else {
      this.brakingForTurn = false
    }

    // Keep pace with the remote sample stream and close lag within catchUpSec.
    const catchUpSpeed = dist / Math.max(0.03, catchUpSec)
    const leadSpeed = this.targetSpeed * 1.2
    let wantSpeed: number
    if (this.brakingForTurn) {
      wantSpeed = 0
    } else if (dist < ARRIVE_RADIUS_PX) {
      wantSpeed =
        Math.min(Math.max(cruiseSpeed, leadSpeed), maxSpeed) *
        (dist / ARRIVE_RADIUS_PX)
    } else {
      wantSpeed = Math.min(
        maxSpeed,
        Math.max(cruiseSpeed, leadSpeed, catchUpSpeed),
      )
    }

    const wantVx = desiredX * wantSpeed
    const wantVy = desiredY * wantSpeed
    let steerX = wantVx - this.vx
    let steerY = wantVy - this.vy
    const steerMag = Math.hypot(steerX, steerY)
    const accelBudget =
      dist > CATCH_UP_DIST_PX && !this.brakingForTurn ? catchUpAccel : accel
    const maxDeltaV =
      (this.brakingForTurn || wantSpeed < speed ? brake : accelBudget) * dt
    if (steerMag > maxDeltaV && steerMag > 0) {
      steerX = (steerX / steerMag) * maxDeltaV
      steerY = (steerY / steerMag) * maxDeltaV
    }
    this.vx += steerX
    this.vy += steerY

    const nextSpeed = Math.hypot(this.vx, this.vy)
    if (nextSpeed > maxSpeed) {
      this.vx = (this.vx / nextSpeed) * maxSpeed
      this.vy = (this.vy / nextSpeed) * maxSpeed
    }

    this.x += this.vx * dt
    this.y += this.vy * dt
    return { x: this.x, y: this.y }
  }
}
