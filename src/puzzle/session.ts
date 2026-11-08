import { nanoid } from 'nanoid'

export const GALLERY_IMAGE_URLS: readonly string[] = [
  'https://i.pinimg.com/1200x/9c/aa/eb/9caaeb6af14fed21ba25e5087479118a.jpg',
  'https://i.pinimg.com/1200x/ac/07/e2/ac07e23cd8fadc3ba79a44b82de759fd.jpg',
]

export const DEFAULT_IMAGE_URL = GALLERY_IMAGE_URLS[1]

export const DEFAULT_PIECE_COUNT = 30

/** URL-safe NanoID. Same collision odds as a UUID, with no encoding in the path. */
const SESSION_ID_LENGTH = 21
const NANO_ID = new RegExp(`^[A-Za-z0-9_-]{${SESSION_ID_LENGTH}}$`)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PuzzleSetup {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  pieceCount: number
  seed: number
}

export function createSessionId(): string {
  return nanoid(SESSION_ID_LENGTH)
}

/** Shareable path. /play/ is a real file on Pages, so this URL returns 200. */
export function playInvitePath(sessionId: string): string {
  return `/play/?id=${encodeURIComponent(sessionId)}`
}

export function normalizeSessionId(value: string): string | null {
  const id = value.trim()
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
  }
}

function storageKey(sessionId: string): string {
  return `jigsaw-session:${sessionId}`
}

export function readSession(sessionId: string): PuzzleSetup | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    if (!raw) return null
    return parseSetup(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function writeSession(sessionId: string, setup: PuzzleSetup): void {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(setup))
  } catch {
    // ignore quota / privacy mode errors
  }
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
