/**
 * Pointer and piece motion share one kinematic compressor.
 *
 * The sender keeps the last knot's position, velocity, and acceleration.
 * Samples that still lie on that constant-acceleration curve are dropped,
 * so small wobble becomes the curve instead of a packet. Knots that must
 * be exact (the pointer stopped, a drag ended) are anchors: zero velocity
 * and a position the receiver is required to hit.
 *
 * The receiver draws a cubic Hermite spline through the knots, which passes
 * through every knot and changes acceleration smoothly along the segment.
 * Past the newest knot it integrates the same acceleration, until an anchor
 * freezes the point.
 */

export const MOTION_Q = 32

const STOP_SPEED_PX_S = 12
const ACCEL_LIMIT = 80_000

export interface Sample {
  x: number
  y: number
  t: number
}

export interface MotionPacket {
  hide: boolean
  anchor: boolean
  abs: boolean
  x: number
  y: number
  dt: number
  vx: number
  vy: number
  ax: number
  ay: number
}

export interface MotionSenderOptions {
  tolerancePx: number
  minGapMs: number
  maxGapMs: number
  /** 0 sends absolute coordinates on every knot. */
  absoluteEveryMs: number
}

interface Basis {
  x: number
  y: number
  t: number
  vx: number
  vy: number
  ax: number
  ay: number
  qx: number
  qy: number
}

const FLAG_ANCHOR = 1
const FLAG_ABS = 2
const FLAG_HIDE = 4

export function quantize(px: number): number {
  return Math.round(px * MOTION_Q)
}

export function dequantize(quanta: number): number {
  return quanta / MOTION_Q
}

export class MotionSender {
  private readonly options: MotionSenderOptions
  private basis: Basis | null = null
  private lastSample: Sample | null = null
  private vx = 0
  private vy = 0
  private ax = 0
  private ay = 0
  private stopped = true
  private lastAbsoluteAt = Number.NEGATIVE_INFINITY

  constructor(options: MotionSenderOptions) {
    this.options = options
  }

  reset(): void {
    this.basis = null
    this.lastSample = null
    this.vx = 0
    this.vy = 0
    this.ax = 0
    this.ay = 0
    this.stopped = true
    this.lastAbsoluteAt = Number.NEGATIVE_INFINITY
  }

  observe(sample: Sample, force = false): MotionPacket | null {
    const prev = this.lastSample
    this.lastSample = sample
    if (!prev) {
      this.stopped = false
      return this.emit(sample, false)
    }
    const dtMs = sample.t - prev.t
    if (dtMs > 0 && dtMs < 250) {
      const dt = dtMs / 1000
      const instVx = (sample.x - prev.x) / dt
      const instVy = (sample.y - prev.y) / dt
      const instAx = (instVx - this.vx) / dt
      const instAy = (instVy - this.vy) / dt
      this.vx += (instVx - this.vx) * 0.45
      this.vy += (instVy - this.vy) * 0.45
      this.ax += (clampAccel(instAx) - this.ax) * 0.35
      this.ay += (clampAccel(instAy) - this.ay) * 0.35
    }
    if (Math.hypot(this.vx, this.vy) >= STOP_SPEED_PX_S) this.stopped = false
    if (!this.basis) return this.emit(sample, false)

    const elapsed = sample.t - this.basis.t
    const predicted = integrate(this.basis, elapsed)
    const error = Math.hypot(sample.x - predicted.x, sample.y - predicted.y)
    const due = elapsed >= this.options.maxGapMs
    const tooSoon = elapsed < this.options.minGapMs
    if (!force && error <= this.options.tolerancePx && !due) return null
    if (!force && tooSoon && error < this.options.tolerancePx * 8) return null
    return this.emit(sample, false)
  }

  /** Exact position, then hold. Repeated calls with the same point do nothing. */
  flushAnchor(): MotionPacket | null {
    const sample = this.lastSample
    if (!sample) return null
    const qx = quantize(sample.x)
    const qy = quantize(sample.y)
    if (
      this.stopped &&
      this.basis &&
      this.basis.qx === qx &&
      this.basis.qy === qy &&
      this.basis.vx === 0 &&
      this.basis.vy === 0
    ) {
      return null
    }
    this.vx = 0
    this.vy = 0
    this.ax = 0
    this.ay = 0
    this.stopped = true
    return this.emit(sample, true)
  }

  conceal(): MotionPacket {
    this.reset()
    return {
      hide: true,
      anchor: false,
      abs: true,
      x: 0,
      y: 0,
      dt: 0,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
    }
  }

  private emit(sample: Sample, anchor: boolean): MotionPacket {
    const qx = quantize(sample.x)
    const qy = quantize(sample.y)
    const prior = this.basis
    const elapsed = prior ? Math.max(0, Math.round(sample.t - prior.t)) : 0
    const absolute =
      anchor ||
      !prior ||
      this.options.absoluteEveryMs <= 0 ||
      sample.t - this.lastAbsoluteAt >= this.options.absoluteEveryMs
    const qvx = anchor ? 0 : quantize(this.vx)
    const qvy = anchor ? 0 : quantize(this.vy)
    const qax = anchor ? 0 : quantize(this.ax)
    const qay = anchor ? 0 : quantize(this.ay)
    const packet: MotionPacket = {
      hide: false,
      anchor,
      abs: absolute,
      x: absolute || !prior ? qx : qx - prior.qx,
      y: absolute || !prior ? qy : qy - prior.qy,
      dt: elapsed,
      vx: qvx,
      vy: qvy,
      ax: qax,
      ay: qay,
    }
    this.basis = {
      x: qx / MOTION_Q,
      y: qy / MOTION_Q,
      t: sample.t,
      vx: qvx / MOTION_Q,
      vy: qvy / MOTION_Q,
      ax: qax / MOTION_Q,
      ay: qay / MOTION_Q,
      qx,
      qy,
    }
    if (absolute) this.lastAbsoluteAt = sample.t
    return packet
  }
}

function clampAccel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(ACCEL_LIMIT, Math.max(-ACCEL_LIMIT, value))
}

function integrate(basis: Basis, elapsedMs: number): { x: number; y: number } {
  const dt = elapsedMs / 1000
  return {
    x: basis.x + basis.vx * dt + 0.5 * basis.ax * dt * dt,
    y: basis.y + basis.vy * dt + 0.5 * basis.ay * dt * dt,
  }
}

export function encodeMotion(packet: MotionPacket): number[] {
  let flags = 0
  if (packet.anchor) flags |= FLAG_ANCHOR
  if (packet.abs) flags |= FLAG_ABS
  if (packet.hide) flags |= FLAG_HIDE
  if (packet.hide) return [flags]
  if (packet.anchor) return [flags, packet.x, packet.y, packet.dt]
  return [
    flags,
    packet.x,
    packet.y,
    packet.dt,
    packet.vx,
    packet.vy,
    packet.ax,
    packet.ay,
  ]
}

export function decodeMotion(data: unknown): MotionPacket | null {
  if (!Array.isArray(data) || data.some((item) => !isInt(item))) return null
  const flags = data[0] ?? 0
  const anchor = (flags & FLAG_ANCHOR) !== 0
  const abs = anchor || (flags & FLAG_ABS) !== 0
  const hide = (flags & FLAG_HIDE) !== 0
  if (hide) {
    return {
      hide: true,
      anchor: false,
      abs: true,
      x: 0,
      y: 0,
      dt: 0,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
    }
  }
  if (anchor) {
    if (data.length < 4) return null
    return {
      hide: false,
      anchor: true,
      abs: true,
      x: data[1] ?? 0,
      y: data[2] ?? 0,
      dt: data[3] ?? 0,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
    }
  }
  if (data.length < 8) return null
  return {
    hide: false,
    anchor: false,
    abs,
    x: data[1] ?? 0,
    y: data[2] ?? 0,
    dt: data[3] ?? 0,
    vx: data[4] ?? 0,
    vy: data[5] ?? 0,
    ax: data[6] ?? 0,
    ay: data[7] ?? 0,
  }
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

interface Knot {
  x: number
  y: number
  t: number
  vx: number
  vy: number
  ax: number
  ay: number
  anchor: boolean
}

const RENDER_LAG_MS = 45
const EXTRAPOLATE_MS = 200
const MAX_KNOTS = 12

export class MotionTrack {
  private knots: Knot[] = []
  private absX = 0
  private absY = 0
  private hasAbs = false
  hidden = false

  reset(): void {
    this.knots = []
    this.hasAbs = false
    this.hidden = false
  }

  push(packet: MotionPacket, now: number): void {
    if (packet.hide) {
      this.hidden = true
      this.knots = []
      this.hasAbs = false
      return
    }
    if (!packet.abs && !this.hasAbs) return
    this.hidden = false
    const x = packet.abs
      ? dequantize(packet.x)
      : this.absX + dequantize(packet.x)
    const y = packet.abs
      ? dequantize(packet.y)
      : this.absY + dequantize(packet.y)
    this.absX = x
    this.absY = y
    this.hasAbs = true
    const prev = this.knots[this.knots.length - 1]
    if (prev) {
      const dt = Math.max(1, packet.dt)
      const shift = now - dt - prev.t
      for (const knot of this.knots) knot.t += shift
    }
    this.knots.push({
      x,
      y,
      t: now,
      vx: dequantize(packet.vx),
      vy: dequantize(packet.vy),
      ax: dequantize(packet.ax),
      ay: dequantize(packet.ay),
      anchor: packet.anchor,
    })
    if (this.knots.length > MAX_KNOTS) this.knots.shift()
  }

  sample(now: number): { x: number; y: number } | null {
    if (this.hidden || this.knots.length === 0) return null
    const renderT = now - RENDER_LAG_MS
    const first = this.knots[0]
    if (!first) return null
    if (renderT <= first.t) return { x: first.x, y: first.y }
    let index = 0
    for (let i = 0; i < this.knots.length; i += 1) {
      const knot = this.knots[i]
      if (knot && knot.t <= renderT) index = i
    }
    const left = this.knots[index]
    const right = this.knots[index + 1]
    if (!left) return null
    if (right) {
      const span = Math.max(1, right.t - left.t)
      const u = Math.min(1, Math.max(0, (renderT - left.t) / span))
      return {
        x: hermite(left.x, left.vx / 1000, right.x, right.vx / 1000, span, u),
        y: hermite(left.y, left.vy / 1000, right.y, right.vy / 1000, span, u),
      }
    }
    if (left.anchor) return { x: left.x, y: left.y }
    const elapsed =
      Math.min(Math.max(0, renderT - left.t), EXTRAPOLATE_MS) / 1000
    return {
      x: left.x + left.vx * elapsed + 0.5 * left.ax * elapsed * elapsed,
      y: left.y + left.vy * elapsed + 0.5 * left.ay * elapsed * elapsed,
    }
  }
}

/** Cubic Hermite. `v0` and `v1` are in position units per millisecond. */
export function hermite(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  span: number,
  u: number,
): number {
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  return h00 * p0 + h10 * span * v0 + h01 * p1 + h11 * span * v1
}
