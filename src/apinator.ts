import { Apinator, type ConnectionState } from '@apinator/client'
import { APINATOR_APP_SECRET, installLocalPuzzleAuth } from './apinatorAuth.ts'
import { createMockApinator } from './apinatorMock.ts'
import { i18nError } from './i18n/errors.ts'

function readAppKey(): string {
  const raw = import.meta.env.VITE_APINATOR_APP_KEY
  if (typeof raw !== 'string') return ''
  const key = raw.trim()
  if (key === '' || key === 'undefined' || key === 'null') return ''
  return key
}

/** Inlined at build time from VITE_APINATOR_APP_KEY. */
export const APINATOR_APP_KEY = readAppKey()
/** Local stand-in used by `vite` when no app key is configured. */
export const APINATOR_MOCK = APINATOR_APP_KEY === '' && import.meta.env.DEV

export interface RealtimeChannel {
  readonly subscribed: boolean
  bind(event: string, callback: (data: unknown) => void): void
  unbind(event: string, callback?: (data: unknown) => void): void
  trigger(event: string, data: unknown): void
}

export interface RealtimeClient {
  readonly state: ConnectionState
  readonly socketId: string | null
  connect(): void
  subscribe(channelName: string): RealtimeChannel
  unsubscribe(channelName: string): void
  bind(event: string, callback: (data: unknown) => void): void
}
export const APINATOR_CLUSTER = 'eu'
export const APINATOR_CHANNEL = 'my-channel'
export const APINATOR_EVENT = 'my-event'

export interface ApinatorEventRecord {
  id: number
  at: string
  data: unknown
}

export type ChannelSubscription = 'pending' | 'subscribed' | 'error'

export interface ApinatorSnapshot {
  state: ConnectionState
  socketId: string | null
  subscription: ChannelSubscription
  events: readonly ApinatorEventRecord[]
  error: string | null
}

const CONNECTION_STATES: readonly ConnectionState[] = [
  'initialized',
  'connecting',
  'connected',
  'unavailable',
  'disconnected',
]

function isConnectionState(value: unknown): value is ConnectionState {
  return (
    typeof value === 'string' &&
    (CONNECTION_STATES as readonly string[]).includes(value)
  )
}

function isStateChange(
  data: unknown,
): data is { previous: string; current: ConnectionState } {
  if (typeof data !== 'object' || data === null) return false
  const value = data as { previous?: unknown; current?: unknown }
  return typeof value.previous === 'string' && isConnectionState(value.current)
}

function errorText(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const record = data as { message?: unknown; error?: unknown }
    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message
    }
    if (typeof record.error === 'string' && record.error.length > 0) {
      return record.error
    }
  }
  try {
    return JSON.stringify(data)
  } catch {
    return i18nError('connection')
  }
}

const listeners = new Set<() => void>()
let nextEventId = 1

let snapshot: ApinatorSnapshot = {
  state: 'initialized',
  socketId: null,
  subscription: 'pending',
  events: [],
  error: null,
}

function commit(next: ApinatorSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function subscribeApinatorStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getApinatorStatus(): ApinatorSnapshot {
  return snapshot
}

if (APINATOR_APP_KEY && APINATOR_APP_SECRET) {
  installLocalPuzzleAuth(APINATOR_APP_KEY, APINATOR_APP_SECRET)
}

export const apinator: RealtimeClient | null = APINATOR_APP_KEY
  ? new Apinator({
      appKey: APINATOR_APP_KEY,
      cluster: APINATOR_CLUSTER,
      authEndpoint: '/api/realtime/auth',
    })
  : APINATOR_MOCK
    ? createMockApinator()
    : null

function startApinator(client: RealtimeClient): void {
  client.connect()

  const channel = client.subscribe(APINATOR_CHANNEL)

  snapshot = {
    state: client.state,
    socketId: client.socketId,
    subscription: 'pending',
    events: [],
    error: null,
  }

  client.bind('state_change', (data) => {
    if (!isStateChange(data)) return
    const connected = data.current === 'connected'
    commit({
      ...snapshot,
      state: data.current,
      socketId: client.socketId,
      error: connected ? null : snapshot.error,
      subscription: connected ? snapshot.subscription : 'pending',
    })
  })

  client.bind('realtime:error', (data) => {
    commit({ ...snapshot, error: errorText(data) })
  })

  channel.bind('realtime:subscription_succeeded', () => {
    commit({ ...snapshot, subscription: 'subscribed' })
  })

  channel.bind('realtime:subscription_error', (data) => {
    commit({
      ...snapshot,
      subscription: 'error',
      error: errorText(data),
    })
  })

  channel.bind(APINATOR_EVENT, (data) => {
    if (import.meta.env.DEV) console.log('Received:', data)
    const record: ApinatorEventRecord = {
      id: nextEventId,
      at: new Date().toISOString(),
      data,
    }
    nextEventId += 1
    commit({
      ...snapshot,
      socketId: client.socketId,
      events: [record, ...snapshot.events].slice(0, 5),
    })
  })
}

if (apinator) {
  startApinator(apinator)
} else {
  snapshot = {
    state: 'unavailable',
    socketId: null,
    subscription: 'error',
    events: [],
    error: i18nError('appKeyMissing'),
  }
}
