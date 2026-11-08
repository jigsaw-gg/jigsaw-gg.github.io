import { useEffect, useRef, useState } from 'react'
import type { Channel } from '@apinator/client'
import { apinator } from '../apinator.ts'
import {
  parseSetup,
  puzzleChannelName,
  readSession,
  writeSession,
  type PuzzleSetup,
} from './session.ts'

const REQUEST_EVENT = 'client-session-request'
const OFFER_EVENT = 'client-session-offer'
const REQUEST_INTERVAL_MS = 2000

export type SessionPhase = 'connecting' | 'live' | 'error'

export function usePuzzleSession(sessionId: string): {
  setup: PuzzleSetup | null
  phase: SessionPhase
  channelError: string | null
  channelName: string
  source: 'local' | 'peer' | null
} {
  const [setup, setSetup] = useState<PuzzleSetup | null>(() =>
    readSession(sessionId),
  )
  const [phase, setPhase] = useState<SessionPhase>('connecting')
  const [channelError, setChannelError] = useState<string | null>(null)
  const [source, setSource] = useState<'local' | 'peer' | null>(() =>
    readSession(sessionId) ? 'local' : null,
  )
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
    let timer = 0

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

    const onReady = () => {
      setPhase('live')
      setChannelError(null)
      requestSetup()
    }

    const onError = (data: unknown) => {
      setPhase('error')
      setChannelError(subscriptionError(data))
    }

    channel.bind(OFFER_EVENT, onOffer)
    channel.bind(REQUEST_EVENT, onRequest)
    channel.bind('realtime:subscription_succeeded', onReady)
    channel.bind('realtime:subscription_error', onError)

    const readyNow = window.setTimeout(() => {
      if (channel.subscribed) onReady()
    }, 0)
    timer = window.setInterval(requestSetup, REQUEST_INTERVAL_MS)

    return () => {
      window.clearTimeout(readyNow)
      window.clearInterval(timer)
      channel.unbind(OFFER_EVENT, onOffer)
      channel.unbind(REQUEST_EVENT, onRequest)
      channel.unbind('realtime:subscription_succeeded', onReady)
      channel.unbind('realtime:subscription_error', onError)
      client.unsubscribe(channelName)
    }
  }, [sessionId])

  return {
    setup,
    phase,
    channelError,
    channelName: puzzleChannelName(sessionId),
    source,
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

function subscriptionError(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const record = data as { error?: unknown; message?: unknown }
    if (typeof record.error === 'string' && record.error) return record.error
    if (typeof record.message === 'string' && record.message)
      return record.message
  }
  return 'Could not join the private channel.'
}
