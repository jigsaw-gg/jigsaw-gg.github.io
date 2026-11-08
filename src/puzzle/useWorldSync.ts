import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '../apinator.ts'
import { buildPuzzle } from './cut.ts'
import { releasePuzzleChannel, retainPuzzleChannel } from './channelRetain.ts'
import {
  decodeMotion,
  encodeMotion,
  MotionSender,
  MotionTrack,
  type MotionPacket,
} from './kinematics.ts'
import { scatterPieces, type Placement } from './play.ts'
import type { PuzzleSetup } from './session.ts'
import {
  cursorColor,
  decodePlacements,
  electMaster,
  encodePlacements,
  groupMembers,
  hashEncoded,
  idFromIndex,
  isPlayerId,
  maxRev,
  mergeWorld,
  overlayGroup,
  parseDigestWire,
  parseWorldWire,
  pieceIndex,
  preferClaim,
  quantizePlacements,
  readStoredWorld,
  sameBoard,
  stampMoved,
  touchesPieces,
  writeStoredWorld,
  type StampedPlacement,
  type WorldClaim,
  type WorldWire,
} from './world.ts'

const CURSOR_EVENT = 'client-cursor'
const DRAG_EVENT = 'client-drag'
const WORLD_EVENT = 'client-world'
const DIGEST_EVENT = 'client-world-digest'
const ASK_EVENT = 'client-world-ask'
const DIGEST_MS = 2000
const MEMBER_EVERY = 4

export interface RemoteCursor {
  id: string
  name: string
  color: string
  x: number
  y: number
}

export interface SessionPeer {
  id: string
  name: string
}

interface Geometry {
  cols: number
  rows: number
  cellW: number
  cellH: number
  template: Placement[]
}

interface LiveState {
  key: string
  authorId: string
  hash: number
  placements: StampedPlacement[]
}

interface LiveDrag {
  track: MotionTrack
  anchorId: string
  group: string
  members: string[]
}

interface LocalDrag {
  anchorId: string
  group: string
  members: string[]
  signature: string
  sends: number
}

interface SyncApi {
  reportPointer: (x: number, y: number) => void
  reportPointerGone: () => void
  reportDrag: (placements: Placement[], anchorId: string) => void
  reportDragEnd: (placements: Placement[]) => void
  reportDragCancel: () => void
}

export function useWorldSync(
  sessionId: string,
  player: { id: string; name: string },
  setup: PuzzleSetup | null,
  peers: readonly SessionPeer[],
): {
  placements: Placement[] | null
  cursors: RemoteCursor[]
  raisedGroups: readonly string[]
  masterId: string | null
  yieldNonce: number
  reportPointer: (x: number, y: number) => void
  reportPointerGone: () => void
  reportDrag: (placements: Placement[], anchorId: string) => void
  reportDragEnd: (placements: Placement[]) => void
  reportDragCancel: () => void
} {
  const built = useMemo(() => {
    if (!setup) return null
    const model = buildPuzzle(setup)
    const scattered = scatterPieces(model, setup.seed)
    return {
      key: `${sessionId}:${setup.seed}:${setup.pieceCount}:${setup.imageWidth}x${setup.imageHeight}`,
      cols: model.cols,
      rows: model.rows,
      cellW: scattered.cellW,
      cellH: scattered.cellH,
      template: scattered.placements,
      setup,
    }
  }, [sessionId, setup])

  const [world, setWorld] = useState<LiveState | null>(null)
  const [view, setView] = useState<Placement[] | null>(null)
  const [cursors, setCursors] = useState<RemoteCursor[]>([])
  const [raisedGroups, setRaisedGroups] = useState<readonly string[]>([])
  const [yieldNonce, setYieldNonce] = useState(0)

  const geometryRef = useRef<Geometry | null>(null)
  const setupRef = useRef(setup)
  const liveRef = useRef<LiveState | null>(null)
  const peersRef = useRef(peers)
  const playerRef = useRef(player)

  const puzzleKey = built?.key ?? ''
  if ((world?.key ?? '') !== puzzleKey) {
    const next = built ? loadWorld(sessionId, built, player.id) : null
    setWorld(next)
    setView(next ? strip(next.placements) : null)
  }

  const masterId = useMemo(
    () => electMaster(peers.map((peer) => peer.id)),
    [peers],
  )

  const api = useRef<SyncApi>({
    reportPointer: () => {},
    reportPointerGone: () => {},
    reportDrag: () => {},
    reportDragEnd: () => {},
    reportDragCancel: () => {},
  })

  useEffect(() => {
    setupRef.current = setup
    peersRef.current = peers
    playerRef.current = player
    liveRef.current = world
    geometryRef.current =
      built && world
        ? {
            cols: built.cols,
            rows: built.rows,
            cellW: built.cellW,
            cellH: built.cellH,
            template: built.template,
          }
        : null
  }, [setup, peers, player, world, built])

  useEffect(() => {
    const channel = retainPuzzleChannel(sessionId)
    const cursorSender = new MotionSender({
      tolerancePx: 1.75,
      minGapMs: 28,
      maxGapMs: 140,
      absoluteEveryMs: 320,
    })
    const dragSender = new MotionSender({
      tolerancePx: 1,
      minGapMs: 28,
      maxGapMs: 120,
      absoluteEveryMs: 0,
    })
    const cursorTracks = new Map<string, MotionTrack>()
    const dragTracks = new Map<string, LiveDrag>()
    let localDrag: LocalDrag | null = null
    let cursorShown = false
    let stopTimer = 0
    let dragStopTimer = 0
    let askTimer = 0
    let worldTimer = 0
    let frame = 0
    let closed = false

    const masterNow = () => electMaster(peersRef.current.map((peer) => peer.id))

    const claimOf = (state: LiveState): WorldClaim => ({
      playerId: state.authorId,
      rev: maxRev(state.placements),
      hash: state.hash,
    })

    const publish = (next: LiveState, persist: boolean) => {
      liveRef.current = next
      setWorld(next)
      if (dragTracks.size === 0) setView(strip(next.placements))
      const currentSetup = setupRef.current
      if (!persist || !currentSetup) return
      const cols = geometryRef.current?.cols
      const rows = geometryRef.current?.rows
      if (cols === undefined || rows === undefined) return
      const data = encodePlacements(next.placements, cols, rows)
      if (!data || maxRev(next.placements) < 1) return
      writeStoredWorld(
        sessionId,
        currentSetup,
        maxRev(next.placements),
        next.authorId,
        data,
      )
    }

    const broadcastWorld = () => {
      const state = liveRef.current
      const geo = geometryRef.current
      if (!state || !geo) return
      const data = encodePlacements(state.placements, geo.cols, geo.rows)
      if (!data) return
      trigger(channel, WORLD_EVENT, {
        p: playerRef.current.id,
        r: maxRev(state.placements),
        h: hashEncoded(data),
        d: data,
      })
    }

    const dropLocalDrag = () => {
      if (!localDrag) return
      localDrag = null
      dragSender.reset()
      window.clearTimeout(dragStopTimer)
      setYieldNonce((nonce) => nonce + 1)
    }

    const adopt = (wire: WorldWire) => {
      const state = liveRef.current
      const geo = geometryRef.current
      if (!state || !geo) return
      if (hashEncoded(wire.d) >>> 0 !== wire.h) return
      const decoded = decodePlacements(wire.d, geo.template, geo.cols, geo.rows)
      if (!decoded) return
      const merged = mergeWorld(
        state.placements,
        decoded,
        state.authorId,
        wire.p,
        masterNow(),
      )
      const data = encodePlacements(merged.placements, geo.cols, geo.rows)
      if (!data) return
      const hash = hashEncoded(data)
      const changed = hash !== state.hash
      if (!changed) return
      const dragging = localDrag
      if (
        dragging &&
        touchesPieces(state.placements, merged.placements, dragging.members)
      ) {
        dropLocalDrag()
      }
      dragTracks.delete(wire.p)
      publish(
        {
          key: state.key,
          authorId: merged.authorId,
          hash,
          placements: merged.placements,
        },
        true,
      )
      if (hash !== wire.h) broadcastWorld()
    }

    const sendCursor = (packet: MotionPacket) => {
      if (packet.hide && !cursorShown) return
      cursorShown = !packet.hide
      trigger(channel, CURSOR_EVENT, {
        p: playerRef.current.id,
        c: encodeMotion(packet),
      })
    }

    const sendDrag = (
      anchorId: string,
      group: string,
      members: string[] | undefined,
      packet: MotionPacket,
    ) => {
      const geo = geometryRef.current
      if (!geo) return
      const anchor = pieceIndex(anchorId, geo.cols, geo.rows)
      const groupIndex = pieceIndex(group, geo.cols, geo.rows)
      if (anchor === null || groupIndex === null) return
      const body: {
        p: string
        a: number
        g: number
        c: number[]
        m?: number[]
      } = {
        p: playerRef.current.id,
        a: anchor,
        g: groupIndex,
        c: encodeMotion(packet),
      }
      if (members) {
        const encoded: number[] = []
        for (const id of members) {
          const index = pieceIndex(id, geo.cols, geo.rows)
          if (index === null) return
          encoded.push(index)
        }
        body.m = encoded
      }
      trigger(channel, DRAG_EVENT, body)
    }

    const commit = (placements: Placement[]) => {
      const state = liveRef.current
      const geo = geometryRef.current
      if (!state || !geo) return
      const stamped = stampMoved(
        state.placements,
        quantizePlacements(placements),
        maxRev(state.placements) + 1,
      )
      const data = encodePlacements(stamped, geo.cols, geo.rows)
      if (!data) return
      const hash = hashEncoded(data)
      localDrag = null
      dragSender.reset()
      window.clearTimeout(dragStopTimer)
      if (hash === state.hash) return
      publish(
        {
          key: state.key,
          authorId: playerRef.current.id,
          hash,
          placements: stamped,
        },
        true,
      )
      trigger(channel, WORLD_EVENT, {
        p: playerRef.current.id,
        r: maxRev(stamped),
        h: hash,
        d: data,
      })
    }

    api.current = {
      reportPointer(x, y) {
        const packet = cursorSender.observe({ x, y, t: performance.now() })
        if (packet) sendCursor(packet)
        window.clearTimeout(stopTimer)
        stopTimer = window.setTimeout(() => {
          const anchor = cursorSender.flushAnchor()
          if (anchor) sendCursor(anchor)
        }, 70)
      },
      reportPointerGone() {
        window.clearTimeout(stopTimer)
        sendCursor(cursorSender.conceal())
      },
      reportDrag(placements, anchorId) {
        const anchor = placements.find((piece) => piece.id === anchorId)
        if (!anchor) return
        const members = groupMembers(placements, anchor.group)
        const signature = `${anchorId}|${members.join(',')}`
        const force =
          !localDrag ||
          localDrag.signature !== signature ||
          localDrag.anchorId !== anchorId
        if (localDrag && localDrag.anchorId !== anchorId) dragSender.reset()
        const packet = dragSender.observe(
          { x: anchor.x, y: anchor.y, t: performance.now() },
          force,
        )
        const sends = packet
          ? (localDrag?.sends ?? 0) + 1
          : (localDrag?.sends ?? 0)
        localDrag = {
          anchorId,
          group: anchor.group,
          members,
          signature,
          sends,
        }
        if (packet) {
          const includeMembers = force || sends % MEMBER_EVERY === 1
          sendDrag(
            anchorId,
            anchor.group,
            includeMembers ? members : undefined,
            packet,
          )
        }
        window.clearTimeout(dragStopTimer)
        dragStopTimer = window.setTimeout(() => {
          const held = localDrag
          if (!held) return
          const anchorPacket = dragSender.flushAnchor()
          if (!anchorPacket) return
          sendDrag(held.anchorId, held.group, held.members, anchorPacket)
        }, 70)
      },
      reportDragEnd(placements) {
        const held = localDrag
        const anchorPacket = dragSender.flushAnchor()
        if (held && anchorPacket) {
          sendDrag(held.anchorId, held.group, held.members, anchorPacket)
        }
        commit(placements)
      },
      reportDragCancel() {
        localDrag = null
        dragSender.reset()
        window.clearTimeout(dragStopTimer)
      },
    }

    const onCursor = (data: unknown) => {
      const parsed = parseCursor(data)
      if (!parsed || parsed.p === playerRef.current.id) return
      if (parsed.packet.hide) {
        cursorTracks.delete(parsed.p)
        return
      }
      let track = cursorTracks.get(parsed.p)
      if (!track) {
        track = new MotionTrack()
        cursorTracks.set(parsed.p, track)
      }
      track.push(parsed.packet, performance.now())
    }

    const onDrag = (data: unknown) => {
      const geo = geometryRef.current
      const parsed = parseDrag(data, geo?.cols ?? 0, geo?.rows ?? 0)
      if (!parsed || !geo || parsed.p === playerRef.current.id) return
      const remoteMembers = parsed.members ?? dragTracks.get(parsed.p)?.members
      const members = remoteMembers ?? [parsed.anchorId]
      const held = localDrag
      if (held && overlaps(held.members, members)) {
        if (parsed.p < playerRef.current.id) dropLocalDrag()
        else return
      }
      let drag = dragTracks.get(parsed.p)
      if (!drag) {
        drag = {
          track: new MotionTrack(),
          anchorId: parsed.anchorId,
          group: parsed.group,
          members,
        }
        dragTracks.set(parsed.p, drag)
      }
      drag.anchorId = parsed.anchorId
      drag.group = parsed.group
      if (parsed.members) drag.members = parsed.members
      drag.track.push(parsed.packet, performance.now())
    }

    const onWorld = (data: unknown) => {
      const wire = parseWorldWire(data)
      if (!wire || wire.p === playerRef.current.id) return
      adopt(wire)
    }

    const onDigest = (data: unknown) => {
      const digest = parseDigestWire(data)
      const state = liveRef.current
      if (!digest || !state || digest.p === playerRef.current.id) return
      const incoming = {
        playerId: digest.p,
        rev: digest.r,
        hash: digest.h,
      }
      if (!preferClaim(claimOf(state), incoming, masterNow())) return
      if (askTimer) return
      askTimer = window.setTimeout(() => {
        askTimer = 0
        const latest = liveRef.current
        if (!latest) return
        trigger(channel, ASK_EVENT, {
          p: playerRef.current.id,
          r: maxRev(latest.placements),
          h: latest.hash,
        })
      }, 40)
    }

    const onAsk = (data: unknown) => {
      const ask = parseDigestWire(data)
      const state = liveRef.current
      if (!ask || !state || ask.p === playerRef.current.id) return
      const ours = claimOf(state)
      const incoming = { playerId: ask.p, rev: ask.r, hash: ask.h }
      if (!preferClaim(incoming, ours, masterNow())) return
      const ahead = ours.rev > ask.r
      const host = playerRef.current.id === masterNow()
      if (!ahead && !host) return
      if (worldTimer) return
      worldTimer = window.setTimeout(() => {
        worldTimer = 0
        broadcastWorld()
      }, 40)
    }

    const paint = (now: number) => {
      const names = new Map(
        peersRef.current.map((peer) => [peer.id, peer.name]),
      )
      const nextCursors: RemoteCursor[] = []
      for (const [id, track] of cursorTracks) {
        const point = track.sample(now)
        if (!point) continue
        nextCursors.push({
          id,
          name: names.get(id) ?? 'Player',
          color: cursorColor(id),
          x: point.x,
          y: point.y,
        })
      }
      nextCursors.sort((left, right) => left.id.localeCompare(right.id))
      setCursors((prev) =>
        cursorsMatch(prev, nextCursors) ? prev : nextCursors,
      )

      const state = liveRef.current
      const geo = geometryRef.current
      if (!state || !geo) return
      let composed = strip(state.placements)
      const raised: string[] = []
      const ordered = [...dragTracks.entries()].sort((left, right) =>
        left[0] < right[0] ? 1 : -1,
      )
      for (const [, drag] of ordered) {
        const point = drag.track.sample(now)
        if (!point) continue
        raised.push(drag.group)
        composed = overlayGroup(
          composed,
          drag.anchorId,
          drag.group,
          drag.members,
          point.x,
          point.y,
          geo.cellW,
          geo.cellH,
        )
      }
      setRaisedGroups((prev) => (sameStrings(prev, raised) ? prev : raised))
      setView((prev) => {
        if (prev && sameBoard(prev, composed)) return prev
        return composed
      })
    }

    const prune = () => {
      const liveIds = new Set(peersRef.current.map((peer) => peer.id))
      for (const id of cursorTracks.keys()) {
        if (!liveIds.has(id)) cursorTracks.delete(id)
      }
      for (const id of dragTracks.keys()) {
        if (!liveIds.has(id)) dragTracks.delete(id)
      }
    }

    channel?.bind(CURSOR_EVENT, onCursor)
    channel?.bind(DRAG_EVENT, onDrag)
    channel?.bind(WORLD_EVENT, onWorld)
    channel?.bind(DIGEST_EVENT, onDigest)
    channel?.bind(ASK_EVENT, onAsk)

    const ready = window.setTimeout(() => {
      if (channel?.subscribed) broadcastWorld()
    }, 0)
    const digestTimer = window.setInterval(() => {
      prune()
      const state = liveRef.current
      if (!state) return
      trigger(channel, DIGEST_EVENT, {
        p: playerRef.current.id,
        r: maxRev(state.placements),
        h: state.hash,
      })
    }, DIGEST_MS)
    const tick = (now: number) => {
      if (closed) return
      paint(now)
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)

    return () => {
      closed = true
      window.clearTimeout(ready)
      window.clearInterval(digestTimer)
      window.clearTimeout(stopTimer)
      window.clearTimeout(dragStopTimer)
      window.clearTimeout(askTimer)
      window.clearTimeout(worldTimer)
      window.cancelAnimationFrame(frame)
      channel?.unbind(CURSOR_EVENT, onCursor)
      channel?.unbind(DRAG_EVENT, onDrag)
      channel?.unbind(WORLD_EVENT, onWorld)
      channel?.unbind(DIGEST_EVENT, onDigest)
      channel?.unbind(ASK_EVENT, onAsk)
      releasePuzzleChannel(sessionId)
      api.current = {
        reportPointer: () => {},
        reportPointerGone: () => {},
        reportDrag: () => {},
        reportDragEnd: () => {},
        reportDragCancel: () => {},
      }
    }
    // Rebind once the puzzle itself is known so the first digest includes it.
  }, [sessionId, built?.key])

  const reportPointer = useCallback((x: number, y: number) => {
    api.current.reportPointer(x, y)
  }, [])
  const reportPointerGone = useCallback(() => {
    api.current.reportPointerGone()
  }, [])
  const reportDrag = useCallback(
    (placements: Placement[], anchorId: string) => {
      api.current.reportDrag(placements, anchorId)
    },
    [],
  )
  const reportDragEnd = useCallback((placements: Placement[]) => {
    api.current.reportDragEnd(placements)
  }, [])
  const reportDragCancel = useCallback(() => {
    api.current.reportDragCancel()
  }, [])

  return {
    placements: view,
    cursors,
    raisedGroups,
    masterId,
    yieldNonce,
    reportPointer,
    reportPointerGone,
    reportDrag,
    reportDragEnd,
    reportDragCancel,
  }
}

function loadWorld(
  sessionId: string,
  built: {
    key: string
    cols: number
    rows: number
    template: Placement[]
    setup: PuzzleSetup
  },
  playerId: string,
): LiveState {
  const stored = readStoredWorld(sessionId, built.setup)
  if (stored && isPlayerId(stored.authorId)) {
    const decoded = decodePlacements(
      stored.data,
      built.template,
      built.cols,
      built.rows,
    )
    if (decoded) {
      const data = encodePlacements(decoded, built.cols, built.rows)
      if (data) {
        return {
          key: built.key,
          authorId: stored.authorId,
          hash: hashEncoded(data),
          placements: decoded,
        }
      }
    }
  }
  const placements = built.template.map((piece) => ({ ...piece, rev: 0 }))
  const data = encodePlacements(placements, built.cols, built.rows)
  return {
    key: built.key,
    authorId: playerId,
    hash: data ? hashEncoded(data) : 0,
    placements,
  }
}

function strip(placements: readonly StampedPlacement[]): Placement[] {
  return placements.map((piece) => ({
    id: piece.id,
    col: piece.col,
    row: piece.row,
    x: piece.x,
    y: piece.y,
    group: piece.group,
  }))
}

function trigger(
  channel: RealtimeChannel | null,
  event: string,
  data: unknown,
): void {
  if (!channel?.subscribed) return
  try {
    channel.trigger(event, data)
  } catch {
    // Subscription can flap while the socket reconnects.
  }
}

function overlaps(
  local: readonly string[],
  remote: readonly string[],
): boolean {
  const held = new Set(local)
  return remote.some((id) => held.has(id))
}

function cursorsMatch(
  left: readonly RemoteCursor[],
  right: readonly RemoteCursor[],
): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b || a.id !== b.id || a.name !== b.name) return false
    if (Math.abs(a.x - b.x) > 0.2 || Math.abs(a.y - b.y) > 0.2) return false
  }
  return true
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function parseCursor(
  data: unknown,
): { p: string; packet: MotionPacket } | null {
  if (typeof data !== 'object' || data === null) return null
  const value = data as { p?: unknown; c?: unknown }
  if (!isPlayerId(value.p)) return null
  const packet = decodeMotion(value.c)
  if (!packet) return null
  return { p: value.p, packet }
}

function parseDrag(
  data: unknown,
  cols: number,
  rows: number,
): {
  p: string
  anchorId: string
  group: string
  members: string[] | null
  packet: MotionPacket
} | null {
  if (typeof data !== 'object' || data === null || cols < 1 || rows < 1)
    return null
  const value = data as {
    p?: unknown
    a?: unknown
    g?: unknown
    m?: unknown
    c?: unknown
  }
  if (!isPlayerId(value.p)) return null
  const count = cols * rows
  if (!isIndex(value.a, count) || !isIndex(value.g, count)) return null
  const packet = decodeMotion(value.c)
  if (!packet || packet.hide) return null
  let members: string[] | null = null
  if (value.m !== undefined) {
    if (
      !Array.isArray(value.m) ||
      value.m.length < 1 ||
      value.m.length > count
    ) {
      return null
    }
    members = []
    const seen = new Set<number>()
    for (const item of value.m) {
      if (!isIndex(item, count) || seen.has(item)) return null
      seen.add(item)
      members.push(idFromIndex(item, cols))
    }
  }
  return {
    p: value.p,
    anchorId: idFromIndex(value.a, cols),
    group: idFromIndex(value.g, cols),
    members,
    packet,
  }
}

function isIndex(value: unknown, count: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < count
  )
}
