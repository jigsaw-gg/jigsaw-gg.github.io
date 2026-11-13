/** Drop cached puzzle data after this long without a local read/write. */
export const PUZZLE_STORAGE_TTL_MS = 24 * 60 * 60 * 1000

export const SESSION_STORAGE_PREFIX = 'jigsaw-session:'
export const WORLD_STORAGE_PREFIX = 'jigsaw-world:'

export function readTouchedAt(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const touchedAt = (value as { touchedAt?: unknown }).touchedAt
  if (typeof touchedAt !== 'number' || !Number.isFinite(touchedAt)) return null
  return touchedAt
}

export function isPuzzleStorageExpired(
  touchedAt: number,
  now = Date.now(),
): boolean {
  return now - touchedAt > PUZZLE_STORAGE_TTL_MS
}

/**
 * Remove expired session/world entries. Legacy values with no `touchedAt` get
 * stamped with `now` so they start a fresh 24h window instead of lasting forever.
 */
export function purgeExpiredPuzzleStorage(now = Date.now()): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (
        key.startsWith(SESSION_STORAGE_PREFIX) ||
        key.startsWith(WORLD_STORAGE_PREFIX)
      ) {
        keys.push(key)
      }
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        localStorage.removeItem(key)
        continue
      }
      if (typeof parsed !== 'object' || parsed === null) {
        localStorage.removeItem(key)
        continue
      }
      const touchedAt = readTouchedAt(parsed)
      if (touchedAt === null) {
        localStorage.setItem(key, JSON.stringify({ ...parsed, touchedAt: now }))
        continue
      }
      if (isPuzzleStorageExpired(touchedAt, now)) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // ignore quota / privacy mode errors
  }
}
