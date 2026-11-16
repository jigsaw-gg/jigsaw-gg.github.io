import { create } from '@bufbuild/protobuf'
import {
  ClientEnvelopeSchema,
  HeartbeatSchema,
  StreamFrameSchema,
  StreamKind,
  type StreamFrame,
} from './gen/game_pb.ts'
import { event, withSpan } from '../otel/index.ts'
import { isWebTransportEnabled } from '../core/transportPrefs.ts'
import { WT_CONNECT_TIMEOUT_MS } from '../core/config.ts'
import {
  asWritableBytes,
  encodeStreamFrame,
  payloadToBytes,
  StreamFrameReader,
} from './framing.ts'
import type { PlayEndpoints } from './gameClient.ts'

export type PlayTransportKind = 'webtransport' | 'websocket'

export interface PlayTransport {
  readonly kind: PlayTransportKind
  sendInput(frame: StreamFrame): void
  sendWorld(frame: StreamFrame): void
  close(): void
}

export type PlayTransportHandlers = {
  onInputFrame: (frame: StreamFrame) => void
  onWorldFrame: (frame: StreamFrame) => void
  onClose: (reason: string) => void
}

function supportsWebTransport(): boolean {
  return typeof WebTransport === 'function'
}

async function waitForWebTransportReady(
  transport: WebTransport,
): Promise<void> {
  await Promise.race([
    transport.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error('WebTransport connect timed out')),
        WT_CONNECT_TIMEOUT_MS,
      )
    }),
  ])
}

async function pumpWtStream(
  readable: ReadableStream<Uint8Array>,
  onFrame: (frame: StreamFrame) => void,
  onError: (reason: string) => void,
): Promise<void> {
  const reader = readable.getReader()
  const frames = new StreamFrameReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      frames.push(value)
      for (;;) {
        const frame = frames.next()
        if (!frame) break
        onFrame(frame)
      }
    }
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

/** Server drops idle play sockets until the first client StreamFrame arrives. */
function playHelloFrame(): StreamFrame {
  return create(StreamFrameSchema, {
    stream: StreamKind.INPUT,
    seq: 0n,
    timeMs: BigInt(Date.now()),
    body: {
      case: 'client',
      value: create(ClientEnvelopeSchema, {
        body: {
          case: 'heartbeat',
          value: create(HeartbeatSchema, { nonce: 'open' }),
        },
      }),
    },
  })
}

async function openWebTransport(
  url: string,
  handlers: PlayTransportHandlers,
): Promise<PlayTransport> {
  const transport = new WebTransport(url)
  await waitForWebTransportReady(transport)

  const inputStream = await transport.createBidirectionalStream()
  const worldStream = await transport.createBidirectionalStream()
  const inputWriter = inputStream.writable.getWriter()
  const worldWriter = worldStream.writable.getWriter()
  let closed = false

  const finish = (reason: string) => {
    if (closed) return
    closed = true
    handlers.onClose(reason)
  }

  void pumpWtStream(inputStream.readable, handlers.onInputFrame, finish).then(
    () => finish('input stream ended'),
  )
  void pumpWtStream(worldStream.readable, handlers.onWorldFrame, finish).then(
    () => finish('world stream ended'),
  )

  void transport.closed
    .then(() => finish('webtransport closed'))
    .catch((err: unknown) => {
      finish(err instanceof Error ? err.message : String(err))
    })

  // Classify first accepted stream as INPUT for the server.
  await inputWriter.write(asWritableBytes(encodeStreamFrame(playHelloFrame())))

  return {
    kind: 'webtransport',
    sendInput(frame) {
      if (closed) return
      void inputWriter
        .write(asWritableBytes(encodeStreamFrame(frame)))
        .catch(() => {
          finish('input write failed')
        })
    },
    sendWorld(frame) {
      if (closed) return
      void worldWriter
        .write(asWritableBytes(encodeStreamFrame(frame)))
        .catch(() => {
          finish('world write failed')
        })
    },
    close() {
      if (closed) return
      closed = true
      try {
        transport.close()
      } catch {
        /* ignore */
      }
    },
  }
}

function openWebSocket(
  url: string,
  handlers: PlayTransportHandlers,
): Promise<PlayTransport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    const frames = new StreamFrameReader()
    let closed = false
    let settled = false

    const finish = (reason: string) => {
      if (closed) return
      closed = true
      handlers.onClose(reason)
    }

    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      socket.close()
      reject(new Error('WebSocket connect timed out'))
    }, WT_CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        socket.send(asWritableBytes(encodeStreamFrame(playHelloFrame())))
      } catch (err) {
        socket.close()
        reject(
          err instanceof Error ? err : new Error('WebSocket hello send failed'),
        )
        return
      }
      resolve({
        kind: 'websocket',
        sendInput(frame) {
          if (closed || socket.readyState !== WebSocket.OPEN) return
          socket.send(asWritableBytes(encodeStreamFrame(frame)))
        },
        sendWorld(frame) {
          if (closed || socket.readyState !== WebSocket.OPEN) return
          socket.send(asWritableBytes(encodeStreamFrame(frame)))
        },
        close() {
          if (closed) return
          closed = true
          socket.close()
        },
      })
    }

    socket.onerror = () => {
      if (!settled) {
        settled = true
        window.clearTimeout(timer)
        reject(new Error('WebSocket failed to open'))
        return
      }
      finish('websocket error')
    }

    socket.onclose = () => {
      window.clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(new Error('WebSocket closed before open'))
        return
      }
      finish('websocket closed')
    }

    socket.onmessage = (event) => {
      void (async () => {
        const bytes = await payloadToBytes(event.data)
        if (!bytes) return
        try {
          frames.push(bytes)
          for (;;) {
            const frame = frames.next()
            if (!frame) break
            if (frame.stream === StreamKind.INPUT) handlers.onInputFrame(frame)
            else handlers.onWorldFrame(frame)
          }
        } catch (err) {
          finish(err instanceof Error ? err.message : String(err))
        }
      })()
    }
  })
}

/** Prefer WebTransport (two bidi streams); fall back to multiplexed WebSocket. */
export async function dialPlayTransport(
  endpoints: PlayEndpoints,
  handlers: PlayTransportHandlers,
): Promise<PlayTransport> {
  return withSpan('networking', 'game.play.dial', async (span) => {
    const wtSupported = supportsWebTransport()
    const wtEnabled = isWebTransportEnabled()
    span.setAttributes({
      wtSupported,
      wtEnabled,
      hasWebTransportUrl: Boolean(endpoints.webtransportUrl),
    })

    if (wtEnabled && wtSupported && endpoints.webtransportUrl) {
      try {
        const transport = await openWebTransport(
          endpoints.webtransportUrl,
          handlers,
        )
        span.setAttribute('transport', 'webtransport')
        return transport
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        event('networking', 'game.play.webtransport_failed', {
          reason: message,
          urlHost: (() => {
            try {
              return new URL(endpoints.webtransportUrl).host
            } catch {
              return ''
            }
          })(),
        })
        span.addEvent('webtransport_failed', { reason: message })
        // fall through to WebSocket
      }
    }

    const transport = await openWebSocket(endpoints.websocketUrl, handlers)
    span.setAttribute('transport', 'websocket')
    return transport
  })
}
