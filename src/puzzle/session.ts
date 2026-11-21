import { createUlidLikeId, ULID_LIKE } from '../id.ts'
import {
  isPuzzleStorageExpired,
  readTouchedAt,
  SESSION_STORAGE_PREFIX,
} from './storageTtl.ts'

export const GALLERY_IMAGE_URLS: readonly string[] = [
  'https://i.pinimg.com/1200x/9c/aa/eb/9caaeb6af14fed21ba25e5087479118a.jpg',
  'https://i.pinimg.com/1200x/ac/07/e2/ac07e23cd8fadc3ba79a44b82de759fd.jpg',
  'https://cdnb.artstation.com/p/assets/images/images/060/752/177/large/egor-klyuchnyk-web-hd.jpg',
]

export const DEFAULT_IMAGE_URL = GALLERY_IMAGE_URLS[1]

export const DEFAULT_PIECE_COUNT = 30

/** Legacy 21-char NanoIDs still resolve in invite links. */
const NANO_ID = /^[A-Za-z0-9_-]{21}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PuzzleSetup {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  pieceCount: number
  seed: number
  /** Pieces start turned and players may rotate them in quarter turns. */
  rotationEnabled: boolean
}

export function createSessionId(): string {
  return createUlidLikeId()
}

/** Shareable path. /play/ is a real file on Pages, so this URL returns 200. */
export function playInvitePath(sessionId: string): string {
  return `/play/?id=${encodeURIComponent(sessionId)}`
}

export function normalizeSessionId(value: string): string | null {
  const id = value.trim()
  if (ULID_LIKE.test(id)) return id
  if (NANO_ID.test(id)) return id
  if (UUID.test(id)) return id.toLowerCase()
  return null
}

export function puzzleChannelName(sessionId: string): string {
  return `private-puzzle-${sessionId}`
}

export function isPuzzleChannel(name: string): boolean {
  const prefix = 'private-puzzle-'
  if (!name.startsWith(prefix)) return false
  return normalizeSessionId(name.slice(prefix.length)) !== null
}

export function parseSetup(data: unknown): PuzzleSetup | null {
  if (typeof data !== 'object' || data === null) return null
  const value = data as Partial<PuzzleSetup>
  if (typeof value.imageUrl !== 'string' || value.imageUrl.trim() === '') {
    return null
  }
  const imageWidth = value.imageWidth
  const imageHeight = value.imageHeight
  const pieceCount = value.pieceCount
  const seed = value.seed
  if (!positive(imageWidth) || !positive(imageHeight)) return null
  if (
    typeof pieceCount !== 'number' ||
    !Number.isInteger(pieceCount) ||
    pieceCount < 1
  ) {
    return null
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null
  return {
    imageUrl: value.imageUrl,
    imageWidth,
    imageHeight,
    pieceCount,
    seed: seed >>> 0,
    // Sessions cached before rotation existed have no flag: not rotating.
    rotationEnabled: value.rotationEnabled === true,
  }
}

function storageKey(sessionId: string): string {
  return `${SESSION_STORAGE_PREFIX}${sessionId}`
}

export function readSession(sessionId: string): PuzzleSetup | null {
  try {
    const key = storageKey(sessionId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const setup = parseSetup(parsed)
    if (!setup) {
      localStorage.removeItem(key)
      return null
    }
    const now = Date.now()
    const touchedAt = readTouchedAt(parsed)
    if (touchedAt !== null && isPuzzleStorageExpired(touchedAt, now)) {
      localStorage.removeItem(key)
      return null
    }
    localStorage.setItem(key, JSON.stringify({ ...setup, touchedAt: now }))
    return setup
  } catch {
    return null
  }
}

export function writeSession(sessionId: string, setup: PuzzleSetup): void {
  try {
    localStorage.setItem(
      storageKey(sessionId),
      JSON.stringify({ ...setup, touchedAt: Date.now() }),
    )
  } catch {
    // ignore quota / privacy mode errors
  }
}

/** Keep the session cache alive while the matching world is still in use. */
export function touchSession(sessionId: string): void {
  try {
    const key = storageKey(sessionId)
    const raw = localStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    const setup = parseSetup(parsed)
    if (!setup) {
      localStorage.removeItem(key)
      return
    }
    const now = Date.now()
    const touchedAt = readTouchedAt(parsed)
    if (touchedAt !== null && isPuzzleStorageExpired(touchedAt, now)) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, JSON.stringify({ ...setup, touchedAt: now }))
  } catch {
    // ignore quota / privacy mode errors
  }
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
