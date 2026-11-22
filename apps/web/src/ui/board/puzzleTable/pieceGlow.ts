import { useEffect, useRef, useState } from 'react'

/** Nearby-piece glow fade, in milliseconds. */
const GLOW_MS = 260

function allowsMotion(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

interface GlowClock {
  sync: (active: boolean, pulse: number) => void
  stop: () => void
}

/**
 * Proximity eases the glow in and, once the piece leaves, back out.
 * Each join adds a cycle that fades all the way in and then all the way
 * out. A later move must not retarget that cycle, or a fast snap finishes
 * before the first frame and the highlight never appears.
 */
function createGlowClock(publish: (value: number) => void): GlowClock {
  const glow = {
    value: 0,
    phase: 'idle' as 'idle' | 'in' | 'hold' | 'out',
    from: 0,
    to: 0,
    started: 0,
    active: false,
    pulse: 0,
    pending: 0,
    outPays: false,
    frame: 0,
  }

  function kick() {
    if (glow.frame !== 0) return
    if (glow.phase !== 'in' && glow.phase !== 'out') return
    glow.frame = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    glow.frame = 0
    if (glow.phase !== 'in' && glow.phase !== 'out') return
    const span = glow.to - glow.from
    const t = Math.min(1, (now - glow.started) / GLOW_MS)
    const next = glow.from + span * easeInOut(t)
    glow.value = next
    publish(next)
    if (t < 1) {
      kick()
      return
    }
    finish(now)
  }

  function finish(now: number) {
    const pays = glow.phase === 'out' && glow.outPays
    glow.value = glow.to
    publish(glow.to)
    if (pays && glow.pending > 0) glow.pending -= 1
    glow.outPays = false
    glow.phase = 'idle'
    steer(now)
  }

  function begin(phase: 'in' | 'out', now: number) {
    glow.phase = phase
    glow.from = glow.value
    glow.to = phase === 'in' ? 1 : 0
    glow.started = now
    glow.outPays = phase === 'out' && glow.pending > 0
    if (Math.abs(glow.from - glow.to) < 0.001) {
      finish(now)
      return
    }
    kick()
  }

  function steer(now: number) {
    if (!allowsMotion()) {
      if (glow.frame !== 0) {
        cancelAnimationFrame(glow.frame)
        glow.frame = 0
      }
      glow.pending = 0
      glow.outPays = false
      glow.phase = glow.active ? 'hold' : 'idle'
      const next = glow.active ? 1 : 0
      glow.value = next
      publish(next)
      return
    }
    if (glow.phase === 'in') {
      if (!glow.active && glow.pending === 0) begin('out', now)
      else kick()
      return
    }
    if (glow.phase === 'out') {
      kick()
      return
    }
    if (glow.pending > 0) {
      if (glow.value >= 0.999) begin('out', now)
      else begin('in', now)
      return
    }
    if (glow.active) {
      if (glow.value < 0.999) begin('in', now)
      else glow.phase = 'hold'
      return
    }
    if (glow.value > 0.001) begin('out', now)
  }

  return {
    sync(active: boolean, pulse: number) {
      glow.active = active
      if (pulse > glow.pulse) glow.pending += pulse - glow.pulse
      glow.pulse = pulse
      steer(performance.now())
    },
    stop() {
      if (glow.frame === 0) return
      cancelAnimationFrame(glow.frame)
      glow.frame = 0
    },
  }
}

export function usePieceGlow(active: boolean, pulse: number): number {
  const [value, setValue] = useState(0)
  const clock = useRef<GlowClock | null>(null)
  if (clock.current === null) clock.current = createGlowClock(setValue)

  useEffect(() => {
    clock.current?.sync(active, pulse)
  }, [active, pulse])

  useEffect(() => () => clock.current?.stop(), [])

  return value
}
