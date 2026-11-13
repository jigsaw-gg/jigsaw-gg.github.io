import {
  RELAY_ROOM,
  RELAY_WEBSOCKET_URL,
  RELAY_WEBTRANSPORT_URL,
} from './config.ts'
import type {
  RelayLogEntry,
  RelaySnapshot,
  RelayStatus,
  RelayTransport,
} from './types.ts'

const MAX_MESSAGES = 40
const AUTO_PING_MS = 1000
const WT_CONNECT_TIMEOUT_MS = 4000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const listeners = new Set<() => void>()
let nextLogId = 1
let autoPingTimer: ReturnType<typeof setInterval> | null = null
let generation = 0

type PendingPing = {
  nonce: string
  sentAt: number
}

let pendingPing: PendingPing | null = null
let activeTransport: RelayTransport | null = null
let primaryTransport: WebTransport | null = null
let echoTransport: WebTransport | null = null
let primarySocket: WebSocket | null = null
let echoSocket: WebSocket | null = null
let datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null = null

let snapshot: RelaySnapshot = {
  transportType: null,
  status: 'connecting',
  latencyMs: null,
  messages: [],
  error: null,
  autoPing: false,
  webtransportUrl: RELAY_WEBTRANSPORT_URL,
  websocketUrl: RELAY_WEBSOCKET_URL,
}

function commit(patch: Partial<RelaySnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

function pushLog(direction: RelayLogEntry['direction'], text: string): void {
  const entry: RelayLogEntry = {
    id: nextLogId,
    at: new Date().toISOString(),
    direction,
    text,
  }
  nextLogId += 1
  commit({
    messages: [entry, ...snapshot.messages].slice(0, MAX_MESSAGES),
  })
}

function setStatus(status: RelayStatus, error: string | null = null): void {
  commit({ status, error })
}

function stopAutoPingTimer(): void {
  if (autoPingTimer !== null) {
    clearInterval(autoPingTimer)
    autoPingTimer = null
  }
}

function closeSockets(): void {
  if (datagramWriter) {
    try {
      datagramWriter.releaseLock()
    } catch {
      /* ignore */
    }
    datagramWriter = null
  }
  for (const transport of [primaryTransport, echoTransport]) {
    if (!transport) continue
    try {
      transport.close()
    } catch {
      /* ignore */
    }
  }
  primaryTransport = null
  echoTransport = null
  if (primarySocket) {
    primarySocket.onopen = null
    primarySocket.onclose = null
    primarySocket.onerror = null
    primarySocket.onmessage = null
    primarySocket.close()
    primarySocket = null
  }
  if (echoSocket) {
    echoSocket.onopen = null
    echoSocket.onclose = null
    echoSocket.onerror = null
    echoSocket.onmessage = null
    echoSocket.close()
    echoSocket = null
  }
  activeTransport = null
  pendingPing = null
}

async function payloadToText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof Blob) return data.text()
  if (data instanceof ArrayBuffer) return decoder.decode(data)
  if (ArrayBuffer.isView(data)) {
    return decoder.decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  }
  return String(data)
}

function supportsWebTransport(): boolean {
  return typeof WebTransport === 'function'
}

function withClientId(url: string, clientId: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('client_id', clientId)
  return parsed.toString()
}

function finishPing(nonce: string, replyText: string): void {
  if (!pendingPing || pendingPing.nonce !== nonce) return
  const latencyMs = Math.round(performance.now() - pendingPing.sentAt)
  pendingPing = null
  pushLog('in', replyText)
  commit({ latencyMs })
}

async function sendDatagram(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  text: string,
): Promise<void> {
  await writer.write(encoder.encode(text))
}

async function pumpDatagrams(
  transport: WebTransport,
  gen: number,
  onText: (text: string) => void | Promise<void>,
): Promise<void> {
  const reader = transport.datagrams.readable.getReader()
  try {
    while (gen === generation) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      await onText(decoder.decode(value))
    }
  } catch {
    /* transport closed or reset */
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

async function waitForWebTransportReady(
  transport: WebTransport,
  label: string,
): Promise<void> {
  await Promise.race([
    transport.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error(`${label} connect timed out`)),
        WT_CONNECT_TIMEOUT_MS,
      )
    }),
  ])
}

async function pingWebTransport(): Promise<void> {
  if (!datagramWriter) throw new Error('WebTransport datagram writer missing')
  const nonce = crypto.randomUUID().slice(0, 8)
  const frame = `ping ${nonce}`
  pendingPing = { nonce, sentAt: performance.now() }
  pushLog('out', frame)
  await sendDatagram(datagramWriter, frame)
}

function pingWebSocket(socket: WebSocket): void {
  const nonce = crypto.randomUUID().slice(0, 8)
  const frame = `ping ${nonce}`
  pendingPing = { nonce, sentAt: performance.now() }
  pushLog('out', frame)
  socket.send(frame)
}

async function connectWebTransport(gen: number): Promise<boolean> {
  if (!supportsWebTransport()) {
    pushLog('info', 'WebTransport API not available in this browser')
    return false
  }

  const primaryUrl = withClientId(
    RELAY_WEBTRANSPORT_URL,
    `probe-primary-${crypto.randomUUID().slice(0, 8)}`,
  )
  const echoUrl = withClientId(
    RELAY_WEBTRANSPORT_URL,
    `probe-echo-${crypto.randomUUID().slice(0, 8)}`,
  )

  pushLog('info', `Trying WebTransport ${RELAY_WEBTRANSPORT_URL}`)
  const primary = new WebTransport(primaryUrl)
  const echo = new WebTransport(echoUrl)
  primaryTransport = primary
  echoTransport = echo

  try {
    await Promise.all([
      waitForWebTransportReady(primary, 'Primary WebTransport'),
      waitForWebTransportReady(echo, 'Echo WebTransport'),
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    pushLog('info', `WebTransport failed: ${message}`)
    try {
      primary.close()
    } catch {
      /* ignore */
    }
    try {
      echo.close()
    } catch {
      /* ignore */
    }
    if (primaryTransport === primary) primaryTransport = null
    if (echoTransport === echo) echoTransport = null
    return false
  }

  if (gen !== generation) {
    primary.close()
    echo.close()
    return false
  }

  datagramWriter = primary.datagrams.writable.getWriter()

  // Relay does not echo to the sender. A second WT session in the same room
  // answers application pings over datagrams (UDP-like) for RTT.
  void pumpDatagrams(echo, gen, async (text) => {
    if (!text.startsWith('ping ')) return
    const reply = `pong ${text.slice('ping '.length)}`
    const writer = echo.datagrams.writable.getWriter()
    try {
      await sendDatagram(writer, reply)
      pushLog('info', `echo → ${reply}`)
    } finally {
      try {
        writer.releaseLock()
      } catch {
        /* ignore */
      }
    }
  })

  void pumpDatagrams(primary, gen, (text) => {
    if (text.startsWith('pong ')) {
      finishPing(text.slice('pong '.length).trim(), text)
      return
    }
    pushLog('in', text)
  })

  void primary.closed
    .then(() => {
      if (gen !== generation) return
      if (activeTransport !== 'webtransport') return
      pushLog('info', 'WebTransport closed')
      setStatus('disconnected')
      stopAutoPingTimer()
    })
    .catch((err: unknown) => {
      if (gen !== generation) return
      if (activeTransport !== 'webtransport') return
      const message = err instanceof Error ? err.message : String(err)
      pushLog('info', `WebTransport closed: ${message}`)
      setStatus('disconnected', message)
      stopAutoPingTimer()
    })

  activeTransport = 'webtransport'
  commit({ transportType: 'webtransport' })
  setStatus('connected')
  pushLog(
    'info',
    `WebTransport connected (QUIC datagrams; room=${RELAY_ROOM}; echo peer for ping/pong)`,
  )
  return true
}

function waitForSocketOpen(socket: WebSocket, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`${label} failed to open`))
    }
    const onClose = () => {
      cleanup()
      reject(new Error(`${label} closed before open`))
    }
    const cleanup = () => {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onError)
      socket.removeEventListener('close', onClose)
    }
    socket.addEventListener('open', onOpen)
    socket.addEventListener('error', onError)
    socket.addEventListener('close', onClose)
  })
}

async function connectWebSocket(gen: number): Promise<boolean> {
  const primaryUrl = withClientId(
    RELAY_WEBSOCKET_URL,
    `probe-primary-${crypto.randomUUID().slice(0, 8)}`,
  )
  const echoUrl = withClientId(
    RELAY_WEBSOCKET_URL,
    `probe-echo-${crypto.randomUUID().slice(0, 8)}`,
  )

  pushLog('info', `Trying WebSocket ${RELAY_WEBSOCKET_URL}`)

  const primary = new WebSocket(primaryUrl)
  const echo = new WebSocket(echoUrl)
  primary.binaryType = 'arraybuffer'
  echo.binaryType = 'arraybuffer'
  primarySocket = primary
  echoSocket = echo

  try {
    await Promise.all([
      waitForSocketOpen(primary, 'Primary WebSocket'),
      waitForSocketOpen(echo, 'Echo WebSocket'),
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    pushLog('info', `WebSocket failed: ${message}`)
    primary.close()
    echo.close()
    if (primarySocket === primary) primarySocket = null
    if (echoSocket === echo) echoSocket = null
    return false
  }

  if (gen !== generation) {
    primary.close()
    echo.close()
    return false
  }

  // Relay does not echo to the sender. A second socket in the same room
  // answers application pings so we can measure RTT without gRPC.
  echo.addEventListener('message', (event) => {
    void (async () => {
      const text = await payloadToText(event.data)
      if (!text.startsWith('ping ')) return
      const reply = `pong ${text.slice('ping '.length)}`
      echo.send(reply)
      pushLog('info', `echo → ${reply}`)
    })()
  })

  primary.addEventListener('message', (event) => {
    void (async () => {
      const text = await payloadToText(event.data)
      if (text.startsWith('pong ')) {
        const nonce = text.slice('pong '.length).trim()
        finishPing(nonce, text)
        return
      }
      pushLog('in', text)
    })()
  })

  const onPrimaryGone = () => {
    if (gen !== generation) return
    if (activeTransport !== 'websocket') return
    pushLog('info', 'WebSocket disconnected')
    setStatus('disconnected')
    stopAutoPingTimer()
  }
  primary.addEventListener('close', onPrimaryGone)
  primary.addEventListener('error', onPrimaryGone)

  activeTransport = 'websocket'
  commit({ transportType: 'websocket' })
  setStatus('connected')
  pushLog(
    'info',
    `WebSocket connected (room=${RELAY_ROOM}; echo peer for ping/pong)`,
  )
  return true
}

async function connect(gen: number): Promise<void> {
  setStatus('connecting')
  commit({ transportType: null, error: null, latencyMs: null })

  if (await connectWebTransport(gen)) {
    if (gen === generation) await sendPing()
    return
  }

  if (gen !== generation) return

  if (await connectWebSocket(gen)) {
    if (gen === generation) await sendPing()
    return
  }

  if (gen !== generation) return
  setStatus('failed', 'Could not connect via WebTransport or WebSocket')
  pushLog('info', 'All transports failed')
}

export function getGameRelaySnapshot(): RelaySnapshot {
  return snapshot
}

export function subscribeGameRelay(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function sendPing(): Promise<void> {
  if (snapshot.status !== 'connected') return
  try {
    if (activeTransport === 'webtransport' && primaryTransport) {
      await pingWebTransport()
      return
    }
    if (activeTransport === 'websocket' && primarySocket) {
      if (primarySocket.readyState !== WebSocket.OPEN) {
        pushLog('info', 'WebSocket not open; skip ping')
        return
      }
      pingWebSocket(primarySocket)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    pushLog('info', `Ping failed: ${message}`)
    commit({ error: message })
  }
}

export function setAutoPing(enabled: boolean): void {
  commit({ autoPing: enabled })
  stopAutoPingTimer()
  if (!enabled) return
  autoPingTimer = setInterval(() => {
    void sendPing()
  }, AUTO_PING_MS)
  void sendPing()
}

export function startGameRelay(): void {
  generation += 1
  const gen = generation
  stopAutoPingTimer()
  closeSockets()
  commit({
    messages: [],
    latencyMs: null,
    autoPing: false,
    error: null,
  })
  void connect(gen)
}

export function stopGameRelay(): void {
  generation += 1
  stopAutoPingTimer()
  closeSockets()
  setStatus('disconnected')
}

startGameRelay()
