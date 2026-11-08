import type { ConnectionState } from '@apinator/client'
import type { RealtimeChannel, RealtimeClient } from './apinator.ts'

type Callback = (data: unknown) => void

const BUS_NAME = 'jigsaw-apinator-mock'

interface BusMessage {
  origin: string
  channel: string
  event: string
  data: unknown
}

/**
 * In-browser stand-in for Apinator. Used only while developing without an app
 * key. Connection succeeds locally, and client events reach other tabs on
 * this machine. Nothing is sent to the Apinator servers.
 */
export function createMockApinator(): RealtimeClient {
  const origin = `mock-${Math.random().toString(36).slice(2, 10)}`
  const channels = new Map<string, MockChannel>()
  const globalBindings = new Map<string, Set<Callback>>()
  let state: ConnectionState = 'initialized'
  let socketId: string | null = null

  const bus =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(BUS_NAME)

  const client: RealtimeClient = {
    get state() {
      return state
    },
    get socketId() {
      return socketId
    },
    connect() {
      if (state === 'connecting' || state === 'connected') return
      state = 'connecting'
      socketId = origin
      window.setTimeout(() => {
        if (state !== 'connecting') return
        const previous = state
        state = 'connected'
        emitGlobal('state_change', { previous, current: 'connected' })
      }, 0)
    },
    subscribe(channelName) {
      const existing = channels.get(channelName)
      if (existing) return existing
      const channel = new MockChannel((event, data) => {
        const current = channels.get(channelName)
        if (!current?.subscribed) return
        bus?.postMessage({
          origin,
          channel: channelName,
          event,
          data,
        } satisfies BusMessage)
      })
      channels.set(channelName, channel)
      window.setTimeout(() => {
        if (channels.get(channelName) !== channel) return
        channel.markSubscribed()
      }, 0)
      return channel
    },
    unsubscribe(channelName) {
      channels.delete(channelName)
    },
    bind(event, callback) {
      let set = globalBindings.get(event)
      if (!set) {
        set = new Set()
        globalBindings.set(event, set)
      }
      set.add(callback)
    },
  }

  bus?.addEventListener('message', (event: MessageEvent<BusMessage>) => {
    const message = event.data
    if (!message || message.origin === origin) return
    const channel = channels.get(message.channel)
    if (!channel?.subscribed) return
    channel.emit(message.event, message.data)
  })

  function emitGlobal(event: string, data: unknown): void {
    const set = globalBindings.get(event)
    if (!set) return
    for (const callback of [...set]) callback(data)
  }

  return client
}

class MockChannel implements RealtimeChannel {
  private readonly bindings = new Map<string, Set<Callback>>()
  private subscribedFlag = false
  private readonly publish: (event: string, data: unknown) => void

  constructor(publish: (event: string, data: unknown) => void) {
    this.publish = publish
  }

  get subscribed(): boolean {
    return this.subscribedFlag
  }

  bind(event: string, callback: Callback): void {
    let set = this.bindings.get(event)
    if (!set) {
      set = new Set()
      this.bindings.set(event, set)
    }
    set.add(callback)
  }

  unbind(event: string, callback?: Callback): void {
    if (!callback) {
      this.bindings.delete(event)
      return
    }
    this.bindings.get(event)?.delete(callback)
  }

  trigger(event: string, data: unknown): void {
    if (!this.subscribedFlag) return
    this.publish(event, data)
  }

  markSubscribed(): void {
    this.subscribedFlag = true
    this.emit('realtime:subscription_succeeded', {})
  }

  emit(event: string, data: unknown): void {
    const set = this.bindings.get(event)
    if (!set) return
    for (const callback of [...set]) callback(data)
  }
}
