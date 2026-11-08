import { Apinator, type ConnectionState } from '@apinator/client'

function readAppKey(): string {
  const raw = import.meta.env.VITE_APINATOR_APP_KEY
  if (typeof raw !== 'string') return ''
  const key = raw.trim()
  if (key === '' || key === 'undefined' || key === 'null') return ''
  return key
}

/** Inlined at build time from VITE_APINATOR_APP_KEY. */
export const APINATOR_APP_KEY = readAppKey()
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
    return 'Connection error'
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

export const apinator: Apinator | null = APINATOR_APP_KEY
  ? new Apinator({
      appKey: APINATOR_APP_KEY,
      cluster: APINATOR_CLUSTER,
      authEndpoint: '/api/realtime/auth',
    })
  : null

function startApinator(client: Apinator): void {
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
    console.log('Received:', data)
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
    error: 'App key is not set.',
  }
}
