import type { Placement } from './play.ts'
import type { PuzzleSetup } from './session.ts'
import { dequantize, quantize } from './kinematics.ts'

/**
 * Lowest live player id is the host. Every peer computes that from the same
 * heartbeats, so a host who leaves is replaced without a vote.
 *
 * Piece state is a lamport revision plus a hash of the quantized board.
 * Each piece carries its own revision. A higher revision wins that piece, so
 * two players can move different pieces and both moves survive. The host is
 * only the tie-break when the same piece was committed two ways at the same
 * revision. Peers that disagree ask for a snapshot, merge it, and store the
 * result in localStorage.
 */
export interface WorldClaim {
  playerId: string
  rev: number
  hash: number
}

export function electMaster(ids: readonly string[]): string | null {
  let best: string | null = null
  for (const id of ids) {
    if (best === null || id < best) best = id
  }
  return best
}

export function preferClaim(
  current: WorldClaim,
  incoming: WorldClaim,
  masterId: string | null,
): boolean {
  if (incoming.rev > current.rev) return true
  if (incoming.rev < current.rev) return false
  if (incoming.hash === current.hash) return false
  if (incoming.playerId === masterId && current.playerId !== masterId) {
    return true
  }
  if (current.playerId === masterId && incoming.playerId !== masterId) {
    return false
  }
  return incoming.playerId < current.playerId
}

export function hashEncoded(data: readonly number[]): number {
  let hash = 0x811c9dc5
  for (const value of data) {
    hash ^= value >>> 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function parsePieceId(id: string): { col: number; row: number } | null {
  const split = id.indexOf(':')
  if (split <= 0) return null
  const col = Number(id.slice(0, split))
  const row = Number(id.slice(split + 1))
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null
  if (col < 0 || row < 0) return null
  return { col, row }
}

export function pieceIndex(
  id: string,
  cols: number,
  rows: number,
): number | null {
  const at = parsePieceId(id)
  if (!at || at.col >= cols || at.row >= rows) return null
  return at.row * cols + at.col
}

export function idFromIndex(index: number, cols: number): string {
  return `${index % cols}:${Math.floor(index / cols)}`
}

export interface StampedPlacement extends Placement {
  rev: number
}

export function quantizePlacements(
  placements: readonly Placement[],
): Placement[] {
  return placements.map((piece) => ({
    ...piece,
    x: dequantize(quantize(piece.x)),
    y: dequantize(quantize(piece.y)),
  }))
}

export function maxRev(placements: readonly StampedPlacement[]): number {
  let rev = 0
  for (const piece of placements) rev = Math.max(rev, piece.rev)
  return rev
}

export function stampMoved(
  previous: readonly StampedPlacement[],
  next: readonly Placement[],
  rev: number,
): StampedPlacement[] {
  const prior = new Map(previous.map((piece) => [piece.id, piece]))
  return next.map((piece) => {
    const prev = prior.get(piece.id)
    const moved =
      !prev ||
      prev.group !== piece.group ||
      quantize(prev.x) !== quantize(piece.x) ||
      quantize(prev.y) !== quantize(piece.y)
    return { ...piece, rev: moved ? rev : (prev?.rev ?? 0) }
  })
}

export function mergeWorld(
  local: readonly StampedPlacement[],
  incoming: readonly StampedPlacement[],
  localAuthor: string,
  incomingAuthor: string,
  masterId: string | null,
): { placements: StampedPlacement[]; authorId: string; changed: boolean } {
  const incomingById = new Map(incoming.map((piece) => [piece.id, piece]))
  let tookIncoming = false
  let tookLocal = false
  const placements = local.map((piece) => {
    const other = incomingById.get(piece.id)
    if (!other) return piece
    const choice = preferPiece(
      piece,
      other,
      localAuthor,
      incomingAuthor,
      masterId,
    )
    if (choice === 'incoming') {
      tookIncoming = true
      return other
    }
    if (choice === 'local') tookLocal = true
    return piece
  })
  return {
    placements,
    authorId: mergedAuthor(
      localAuthor,
      incomingAuthor,
      masterId,
      tookIncoming,
      tookLocal,
    ),
    changed: tookIncoming,
  }
}

function preferPiece(
  local: StampedPlacement,
  incoming: StampedPlacement,
  localAuthor: string,
  incomingAuthor: string,
  masterId: string | null,
): 'local' | 'incoming' | 'same' {
  if (incoming.rev > local.rev) return 'incoming'
  if (incoming.rev < local.rev) return 'local'
  if (
    local.group === incoming.group &&
    quantize(local.x) === quantize(incoming.x) &&
    quantize(local.y) === quantize(incoming.y)
  ) {
    return 'same'
  }
  if (incomingAuthor === masterId && localAuthor !== masterId) return 'incoming'
  if (localAuthor === masterId && incomingAuthor !== masterId) return 'local'
  return incomingAuthor < localAuthor ? 'incoming' : 'local'
}

function mergedAuthor(
  localAuthor: string,
  incomingAuthor: string,
  masterId: string | null,
  tookIncoming: boolean,
  tookLocal: boolean,
): string {
  if (localAuthor === masterId || incomingAuthor === masterId) {
    return masterId ?? localAuthor
  }
  if (tookIncoming && !tookLocal) return incomingAuthor
  if (tookLocal && !tookIncoming) return localAuthor
  return localAuthor < incomingAuthor ? localAuthor : incomingAuthor
}

export function encodePlacements(
  placements: readonly StampedPlacement[],
  cols: number,
  rows: number,
): number[] | null {
  const sorted = sortByIndex(placements, cols, rows)
  if (!sorted) return null
  const data: number[] = []
  for (const piece of sorted) {
    const group = pieceIndex(piece.group, cols, rows)
    const x = quantize(piece.x)
    const y = quantize(piece.y)
    if (group === null || !fitsQuanta(x) || !fitsQuanta(y)) return null
    if (!Number.isInteger(piece.rev) || piece.rev < 0) return null
    data.push(x, y, group, piece.rev)
  }
  return data
}

export function decodePlacements(
  data: readonly number[],
  template: readonly Placement[],
  cols: number,
  rows: number,
): StampedPlacement[] | null {
  const sorted = sortByIndex(template, cols, rows)
  if (!sorted || data.length !== sorted.length * 4) return null
  const count = cols * rows
  const placements: StampedPlacement[] = []
  for (let index = 0; index < sorted.length; index += 1) {
    const piece = sorted[index]
    const x = data[index * 4]
    const y = data[index * 4 + 1]
    const groupIndex = data[index * 4 + 2]
    const rev = data[index * 4 + 3]
    if (
      !piece ||
      x === undefined ||
      y === undefined ||
      groupIndex === undefined ||
      rev === undefined
    ) {
      return null
    }
    if (!fitsQuanta(x) || !fitsQuanta(y)) return null
    if (
      !Number.isInteger(groupIndex) ||
      groupIndex < 0 ||
      groupIndex >= count
    ) {
      return null
    }
    if (!Number.isInteger(rev) || rev < 0 || rev > 1_000_000_000) return null
    placements.push({
      ...piece,
      x: dequantize(x),
      y: dequantize(y),
      group: idFromIndex(groupIndex, cols),
      rev,
    })
  }
  return placements
}

function sortByIndex<T extends Placement>(
  placements: readonly T[],
  cols: number,
  rows: number,
): T[] | null {
  const sorted: T[] = []
  for (const piece of placements) {
    if (pieceIndex(piece.id, cols, rows) === null) return null
    sorted.push(piece)
  }
  sorted.sort((left, right) => {
    const a = pieceIndex(left.id, cols, rows) ?? 0
    const b = pieceIndex(right.id, cols, rows) ?? 0
    return a - b
  })
  for (let index = 0; index < sorted.length; index += 1) {
    const piece = sorted[index]
    if (!piece || pieceIndex(piece.id, cols, rows) !== index) return null
  }
  return sorted
}

function fitsQuanta(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) < 2_000_000
}

export function sameBoard(
  left: readonly Placement[],
  right: readonly Placement[],
): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b) return false
    if (a.id !== b.id || a.group !== b.group) return false
    if (quantize(a.x) !== quantize(b.x) || quantize(a.y) !== quantize(b.y)) {
      return false
    }
  }
  return true
}

export function overlayGroup(
  placements: readonly Placement[],
  anchorId: string,
  group: string,
  members: readonly string[],
  x: number,
  y: number,
  cellW: number,
  cellH: number,
): Placement[] {
  const anchor = parsePieceId(anchorId)
  if (!anchor) return placements.map((piece) => ({ ...piece }))
  const memberSet = new Set(members)
  return placements.map((piece) => {
    if (!memberSet.has(piece.id)) return piece
    const at = parsePieceId(piece.id)
    if (!at) return piece
    return {
      ...piece,
      group,
      x: x + (at.col - anchor.col) * cellW,
      y: y + (at.row - anchor.row) * cellH,
    }
  })
}

export function groupMembers(
  placements: readonly Placement[],
  group: string,
): string[] {
  const members: string[] = []
  for (const piece of placements) {
    if (piece.group === group) members.push(piece.id)
  }
  members.sort()
  return members
}

export function touchesPieces(
  before: readonly Placement[],
  after: readonly Placement[],
  ids: readonly string[],
): boolean {
  const care = new Set(ids)
  const prior = new Map(before.map((piece) => [piece.id, piece]))
  for (const piece of after) {
    if (!care.has(piece.id)) continue
    const prev = prior.get(piece.id)
    if (!prev) return true
    if (prev.group !== piece.group) return true
    if (quantize(prev.x) !== quantize(piece.x)) return true
    if (quantize(prev.y) !== quantize(piece.y)) return true
  }
  return false
}

interface StoredWorld {
  v: 1
  rev: number
  authorId: string
  data: number[]
}

function storageKey(sessionId: string, setup: PuzzleSetup): string {
  return `jigsaw-world:${sessionId}:${setup.seed}:${setup.pieceCount}:${setup.imageWidth}x${setup.imageHeight}`
}

export function readStoredWorld(
  sessionId: string,
  setup: PuzzleSetup,
): { rev: number; authorId: string; data: number[] } | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId, setup))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredWorld>
    if (parsed.v !== 1 || !Array.isArray(parsed.data)) return null
    if (
      typeof parsed.rev !== 'number' ||
      !Number.isInteger(parsed.rev) ||
      parsed.rev < 1
    ) {
      return null
    }
    if (typeof parsed.authorId !== 'string') return null
    if (parsed.data.some((item) => typeof item !== 'number')) return null
    return {
      rev: parsed.rev,
      authorId: parsed.authorId,
      data: parsed.data,
    }
  } catch {
    return null
  }
}

export function writeStoredWorld(
  sessionId: string,
  setup: PuzzleSetup,
  rev: number,
  authorId: string,
  data: readonly number[],
): void {
  if (rev < 1) return
  const stored: StoredWorld = { v: 1, rev, authorId, data: [...data] }
  try {
    localStorage.setItem(storageKey(sessionId, setup), JSON.stringify(stored))
  } catch {
    // ignore quota / privacy mode errors
  }
}

export interface WorldWire {
  p: string
  r: number
  h: number
  d: number[]
}

export function parseWorldWire(data: unknown): WorldWire | null {
  if (typeof data !== 'object' || data === null) return null
  const value = data as { p?: unknown; r?: unknown; h?: unknown; d?: unknown }
  if (!isPlayerId(value.p)) return null
  if (
    typeof value.r !== 'number' ||
    !Number.isInteger(value.r) ||
    value.r < 0
  ) {
    return null
  }
  if (
    typeof value.h !== 'number' ||
    !Number.isInteger(value.h) ||
    value.h < 0
  ) {
    return null
  }
  if (
    !Array.isArray(value.d) ||
    value.d.some((item) => !Number.isInteger(item))
  ) {
    return null
  }
  return { p: value.p, r: value.r, h: value.h >>> 0, d: value.d }
}

export interface DigestWire {
  p: string
  r: number
  h: number
}

export function parseDigestWire(data: unknown): DigestWire | null {
  if (typeof data !== 'object' || data === null) return null
  const value = data as { p?: unknown; r?: unknown; h?: unknown }
  if (!isPlayerId(value.p)) return null
  if (
    typeof value.r !== 'number' ||
    !Number.isInteger(value.r) ||
    value.r < 0
  ) {
    return null
  }
  if (
    typeof value.h !== 'number' ||
    !Number.isInteger(value.h) ||
    value.h < 0
  ) {
    return null
  }
  return { p: value.p, r: value.r, h: value.h >>> 0 }
}

export function isPlayerId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)
}

const CURSOR_COLORS = [
  '#c73e3a',
  '#1f8a4c',
  '#2d6cdf',
  '#c47b12',
  '#8a3db8',
  '#0e8a8a',
  '#c43e78',
] as const

export function cursorColor(playerId: string): string {
  let hash = 0
  for (let index = 0; index < playerId.length; index += 1) {
    hash = (Math.imul(hash, 33) + playerId.charCodeAt(index)) >>> 0
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length] ?? CURSOR_COLORS[0]
}
