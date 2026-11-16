export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  if (state === 0) state = 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function mixSeed(seed: number, salt: number): number {
  const mixed = Math.imul((seed >>> 0) ^ (salt >>> 0), 0x9e3779b1) >>> 0
  return mixed === 0 ? 1 : mixed
}
