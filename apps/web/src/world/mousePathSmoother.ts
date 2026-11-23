/**
 * Presentation-only path for remote held pieces / cursors.
 *
 * Server ticks are ~10 Hz absolute poses. We intentionally render
 * `renderDelayMs` behind the newest sample and chase that delayed pose —
 * a small lie that absorbs network jitter so a remote stop does not need
 * hard catch-up / projection to "now".
 *
 * No velocity extrapolation past the newest knot: once the delayed clock
 * reaches the last sample, the target holds still.
 * Not authoritative — resting board + release still come from the server.
 */

export type MousePathSmootherOptions = {
  /**
   * How far behind the latest tick to paint (ms). 100–300 keeps motion
   * realistic while cutting stop/turn glitches.
   */
  renderDelayMs: number
  /** Soft cruise when nearly caught up (px/s). */
  cruiseSpeed: number
  /** Hard ceiling (px/s). */
  maxSpeed: number
  /** Close remaining gap to the delayed pose in about this many seconds. */
  catchUpSec: number
  accel: number
  brake: number
  /** Stronger accel when far behind the delayed pose. */
  catchUpAccel: number
}

const DEFAULTS: MousePathSmootherOptions = {
  renderDelayMs: 180,
  cruiseSpeed: 1200,
  maxSpeed: 6_000,
  catchUpSec: 0.12,
  accel: 4800,
  brake: 9000,
  catchUpAccel: 16_000,
}

type TargetSample = { t: number; x: number; y: number }

/** Dot(velocity, desired) below this ⇒ sharp turn (≈100°). */
const SHARP_TURN_DOT = -0.15
const ARRIVE_RADIUS_PX = 28
const SNAP_RADIUS_PX = 2.5
const STATIONARY_SNAP_PX = 6
const MIN_SPEED_PX_S = 12
const STATIONARY_TARGET_PX_S = 35
const CATCH_UP_DIST_PX = 64
const HISTORY_PAD_MS = 500
const MAX_HISTORY = 64

export class MousePathSmoother {
  private readonly options: MousePathSmootherOptions
  private readonly history: TargetSample[] = []
  private x = 0
  private y = 0
  private vx = 0
  private vy = 0
  private tx = 0
  private ty = 0
  private hasPose = false
  private brakingForTurn = false
  private targetSpeed = 0
  private lastStepAt = 0

  constructor(options: Partial<MousePathSmootherOptions> = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  reset(): void {
    this.history.length = 0
    this.x = 0
    this.y = 0
    this.vx = 0
    this.vy = 0
    this.tx = 0
    this.ty = 0
    this.hasPose = false
    this.brakingForTurn = false
    this.targetSpeed = 0
    this.lastStepAt = 0
  }

  /**
   * Collapse history to the current painted pose so the next `setTarget` does
   * not replay through stale knots (e.g. after release settle).
   */
  commitPresentedPose(nowMs = performance.now()): void {
    if (!this.hasPose) return
    this.history.length = 0
    this.history.push({ t: nowMs, x: this.x, y: this.y })
    this.tx = this.x
    this.ty = this.y
    this.vx = 0
    this.vy = 0
    this.brakingForTurn = false
    this.targetSpeed = 0
    this.lastStepAt = nowMs
  }

  /** Latest absolute world target from a Tick pose (buffered, not painted yet). */
  setTarget(x: number, y: number, nowMs = performance.now()): void {
    const last = this.history[this.history.length - 1]
    if (last && nowMs < last.t) return
    if (last && nowMs === last.t) {
      last.x = x
      last.y = y
    } else {
      this.history.push({ t: nowMs, x, y })
    }
    const keepAfter = nowMs - this.options.renderDelayMs - HISTORY_PAD_MS
    while (this.history.length > 1 && (this.history[0]?.t ?? 0) < keepAfter) {
      this.history.shift()
    }
    while (this.history.length > MAX_HISTORY) this.history.shift()

    if (!this.hasPose) {
      this.x = x
      this.y = y
      this.tx = x
      this.ty = y
      this.vx = 0
      this.vy = 0
      this.hasPose = true
      this.brakingForTurn = false
      this.targetSpeed = 0
      this.lastStepAt = nowMs
    }
  }

  /**
   * Advance simulation toward the delayed history sample at `nowMs - delay`.
   * Pass the same clock used for `setTarget` (performance.now()).
   */
  step(
    dtSec: number,
    nowMs = performance.now(),
  ): { x: number; y: number } | null {
    if (!this.hasPose || this.history.length === 0) return null

    this.syncDelayedTarget(nowMs)

    const dt = Math.min(0.05, Math.max(0, dtSec))
    if (dt <= 0) return { x: this.x, y: this.y }

    const { cruiseSpeed, maxSpeed, catchUpSec, accel, brake, catchUpAccel } =
      this.options

    const dx = this.tx - this.x
    const dy = this.ty - this.y
    const dist = Math.hypot(dx, dy)
    const targetMoving = this.targetSpeed >= STATIONARY_TARGET_PX_S
    const snapAt =
      !targetMoving && Math.hypot(this.vx, this.vy) < cruiseSpeed * 0.35
        ? STATIONARY_SNAP_PX
        : SNAP_RADIUS_PX
    if (dist <= snapAt) {
      this.x = this.tx
      this.y = this.ty
      this.vx = 0
      this.vy = 0
      this.brakingForTurn = false
      return { x: this.x, y: this.y }
    }

    const desiredX = dx / dist
    const desiredY = dy / dist

    // Drop the outward radial component so we never pierce through the target
    // and reverse into a bounce.
    const radial = this.vx * desiredX + this.vy * desiredY
    if (radial < 0) {
      this.vx -= radial * desiredX
      this.vy -= radial * desiredY
    }

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

    // Never approach faster than we can brake to a stop at the delayed pose.
    const stopSpeed = Math.sqrt(2 * brake * dist)
    const catchUpSpeed = dist / Math.max(0.03, catchUpSec)
    // Match the delayed path's own speed — do not project ahead of history.
    const leadSpeed = this.targetSpeed

    let wantSpeed: number
    if (this.brakingForTurn) {
      wantSpeed = 0
    } else if (!targetMoving) {
      wantSpeed = Math.min(
        maxSpeed,
        stopSpeed,
        Math.max(leadSpeed, catchUpSpeed),
      )
    } else if (dist < ARRIVE_RADIUS_PX) {
      wantSpeed =
        Math.min(Math.max(cruiseSpeed, leadSpeed), maxSpeed, stopSpeed) *
        (dist / ARRIVE_RADIUS_PX)
    } else {
      const chase = Math.max(cruiseSpeed, leadSpeed, catchUpSpeed)
      wantSpeed = Math.min(
        maxSpeed,
        Math.max(leadSpeed, Math.min(chase, stopSpeed)),
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
    const speedCap = Math.min(maxSpeed, Math.max(stopSpeed, leadSpeed))
    if (nextSpeed > speedCap && nextSpeed > 0) {
      this.vx = (this.vx / nextSpeed) * speedCap
      this.vy = (this.vy / nextSpeed) * speedCap
    }

    const stepDist = Math.hypot(this.vx, this.vy) * dt
    if (stepDist >= dist && !targetMoving) {
      this.x = this.tx
      this.y = this.ty
      this.vx = 0
      this.vy = 0
      this.brakingForTurn = false
      return { x: this.x, y: this.y }
    }

    this.x += this.vx * dt
    this.y += this.vy * dt
    return { x: this.x, y: this.y }
  }

  paintedPose(): { x: number; y: number } | null {
    if (!this.hasPose) return null
    return { x: this.x, y: this.y }
  }

  /** Delayed pose currently being chased (for debug / OTEL). */
  delayedTarget(): { x: number; y: number } | null {
    if (!this.hasPose) return null
    return { x: this.tx, y: this.ty }
  }

  private syncDelayedTarget(nowMs: number): void {
    const renderT = nowMs - this.options.renderDelayMs
    const pose = sampleHistory(this.history, renderT)
    if (!pose) return

    if (this.lastStepAt > 0) {
      const dt = (nowMs - this.lastStepAt) / 1000
      if (dt > 0.001 && dt < 0.5) {
        const moved = Math.hypot(pose.x - this.tx, pose.y - this.ty)
        this.targetSpeed = moved < 0.75 ? 0 : moved / dt
      }
    }
    this.tx = pose.x
    this.ty = pose.y
    this.lastStepAt = nowMs
  }
}

/** Interpolate history at `renderT`. Never extrapolates past the newest sample. */
function sampleHistory(
  history: readonly TargetSample[],
  renderT: number,
): { x: number; y: number } | null {
  const first = history[0]
  if (!first) return null
  if (renderT <= first.t) return { x: first.x, y: first.y }

  const last = history[history.length - 1]
  if (!last) return null
  if (renderT >= last.t) return { x: last.x, y: last.y }

  for (let i = 0; i < history.length - 1; i += 1) {
    const a = history[i]
    const b = history[i + 1]
    if (!a || !b) continue
    if (renderT < a.t || renderT > b.t) continue
    const span = Math.max(1, b.t - a.t)
    const u = (renderT - a.t) / span
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
    }
  }
  return { x: last.x, y: last.y }
}
