import { useEffect, useMemo, useRef, useState } from 'react'
import type { Channel } from '@apinator/client'
import { apinator } from '../apinator.ts'
import { normalizePlayerName } from '../playerName.ts'
import {
  parseSetup,
  puzzleChannelName,
  readSession,
  writeSession,
  type PuzzleSetup,
} from './session.ts'

const REQUEST_EVENT = 'client-session-request'
const OFFER_EVENT = 'client-session-offer'
const ANNOUNCE_EVENT = 'client-player-announce'
const REQUEST_INTERVAL_MS = 2000
/** Drop a player after several missed announcements. */
const PLAYER_STALE_MS = REQUEST_INTERVAL_MS * 3 + 1000

export type SessionPhase = 'connecting' | 'live' | 'error'

export interface SessionPlayer {
  id: string
  name: string
  self: boolean
}

interface PeerRecord {
  name: string
  seen: number
}

export function usePuzzleSession(
  sessionId: string,
  player: { id: string; name: string },
): {
  setup: PuzzleSetup | null
  phase: SessionPhase
  channelError: string | null
  channelName: string
  source: 'local' | 'peer' | null
  players: SessionPlayer[]
} {
  const [setup, setSetup] = useState<PuzzleSetup | null>(() =>
    readSession(sessionId),
  )
  const [phase, setPhase] = useState<SessionPhase>('connecting')
  const [channelError, setChannelError] = useState<string | null>(null)
  const [source, setSource] = useState<'local' | 'peer' | null>(() =>
    readSession(sessionId) ? 'local' : null,
  )
  const [peers, setPeers] = useState<{ id: string; name: string }[]>([])
  const setupRef = useRef(setup)
  useEffect(() => {
    setupRef.current = setup
  }, [setup])

  useEffect(() => {
    const client = apinator
    if (!client) {
      const frame = window.setTimeout(() => {
        setPhase('error')
        setChannelError('App key is not set.')
      }, 0)
      return () => window.clearTimeout(frame)
    }

    const channelName = puzzleChannelName(sessionId)
    const channel = client.subscribe(channelName)
    const knownPeers = new Map<string, PeerRecord>()
    let timer = 0

    const publishPeers = () => {
      setPeers(
        [...knownPeers.entries()]
          .map(([id, peer]) => ({ id, name: peer.name }))
          .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          ),
      )
    }

    const announce = () => {
      if (!channel.subscribed) return
      try {
        channel.trigger(ANNOUNCE_EVENT, {
          playerId: player.id,
          name: player.name,
        })
      } catch {
        // Subscription can flap while the socket reconnects.
      }
    }

    const requestSetup = () => {
      if (setupRef.current || !channel.subscribed) return
      try {
        channel.trigger(REQUEST_EVENT, {})
      } catch {
        // Subscription can flap while the socket reconnects.
      }
    }

    const onOffer = (data: unknown) => {
      if (setupRef.current) return
      const parsed = parseSetup(data)
      if (!parsed) return
      writeSession(sessionId, parsed)
      setupRef.current = parsed
      setSetup(parsed)
      setSource('peer')
    }

    const onRequest = () => {
      const current = setupRef.current
      if (!current) return
      sendOffer(channel, current)
    }

    const onAnnounce = (data: unknown) => {
      const announced = parseAnnounce(data)
      if (!announced || announced.playerId === player.id) return
      const prev = knownPeers.get(announced.playerId)
      knownPeers.set(announced.playerId, {
        name: announced.name,
        seen: Date.now(),
      })
      if (!prev || prev.name !== announced.name) publishPeers()
    }

    const prunePeers = () => {
      const cutoff = Date.now() - PLAYER_STALE_MS
      let removed = false
      for (const [id, peer] of knownPeers) {
        if (peer.seen < cutoff) {
          knownPeers.delete(id)
          removed = true
        }
      }
      if (removed) publishPeers()
    }

    const onReady = () => {
      setPhase('live')
      setChannelError(null)
      requestSetup()
      announce()
    }

    const onError = (data: unknown) => {
      setPhase('error')
      setChannelError(subscriptionError(data))
    }

    channel.bind(OFFER_EVENT, onOffer)
    channel.bind(REQUEST_EVENT, onRequest)
    channel.bind(ANNOUNCE_EVENT, onAnnounce)
    channel.bind('realtime:subscription_succeeded', onReady)
    channel.bind('realtime:subscription_error', onError)

    const readyNow = window.setTimeout(() => {
      if (channel.subscribed) onReady()
    }, 0)
    timer = window.setInterval(() => {
      requestSetup()
      announce()
      prunePeers()
    }, REQUEST_INTERVAL_MS)

    return () => {
      window.clearTimeout(readyNow)
      window.clearInterval(timer)
      channel.unbind(OFFER_EVENT, onOffer)
      channel.unbind(REQUEST_EVENT, onRequest)
      channel.unbind(ANNOUNCE_EVENT, onAnnounce)
      channel.unbind('realtime:subscription_succeeded', onReady)
      channel.unbind('realtime:subscription_error', onError)
      client.unsubscribe(channelName)
      setPeers([])
    }
  }, [sessionId, player.id, player.name])

  const players = useMemo<SessionPlayer[]>(
    () => [
      { id: player.id, name: player.name, self: true },
      ...peers.map((peer) => ({ ...peer, self: false })),
    ],
    [player.id, player.name, peers],
  )

  return {
    setup,
    phase,
    channelError,
    channelName: puzzleChannelName(sessionId),
    source,
    players,
  }
}

function sendOffer(channel: Channel, setup: PuzzleSetup): void {
  if (!channel.subscribed) return
  try {
    channel.trigger(OFFER_EVENT, setup)
  } catch {
    // The other player retries until someone answers.
  }
}

function parseAnnounce(
  data: unknown,
): { playerId: string; name: string } | null {
  if (typeof data !== 'object' || data === null) return null
  const value = data as { playerId?: unknown; name?: unknown }
  if (typeof value.playerId !== 'string' || typeof value.name !== 'string') {
    return null
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value.playerId)) return null
  const name = normalizePlayerName(value.name)
  if (!name) return null
  return { playerId: value.playerId, name }
}

function subscriptionError(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const record = data as { error?: unknown; message?: unknown }
    if (typeof record.error === 'string' && record.error) return record.error
    if (typeof record.message === 'string' && record.message)
      return record.message
  }
  return 'Could not join the private channel.'
}
