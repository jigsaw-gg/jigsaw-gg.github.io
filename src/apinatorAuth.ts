import { isPuzzleChannel } from './puzzle/session.ts'

/** Same path the Vite dev server signs. The static site answers it locally. */
const APINATOR_AUTH_PATH = '/api/realtime/auth'

function readAppSecret(): string {
  const raw = import.meta.env.VITE_APINATOR_APP_SECRET
  if (typeof raw !== 'string') return ''
  const secret = raw.trim()
  if (secret === '' || secret === 'undefined' || secret === 'null') return ''
  return secret
}

export const APINATOR_APP_SECRET = readAppSecret()

let installed = false
let signer: { appKey: string; secret: string } | null = null

/**
 * Apinator's client can only sign a private channel by POSTing to `authEndpoint`.
 * GitHub Pages cannot run that route, and the socket id is only known after
 * connect, so the page signs the request and never sends it to the origin.
 */
export function installLocalPuzzleAuth(appKey: string, secret: string): void {
  signer = { appKey, secret }
  if (installed) return
  installed = true
  const native = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isAuthRequest(input) || !signer) return native(input, init)
    return signAuthRequest(signer.appKey, signer.secret, input, init)
  }) as typeof fetch
}

function isAuthRequest(input: RequestInfo | URL): boolean {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    return new URL(raw, 'http://local').pathname === APINATOR_AUTH_PATH
  } catch {
    return false
  }
}

async function signAuthRequest(
  appKey: string,
  secret: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const raw = await authBody(input, init)
  let payload: { socket_id?: unknown; channel_name?: unknown }
  try {
    payload = JSON.parse(raw) as {
      socket_id?: unknown
      channel_name?: unknown
    }
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }
  const socketId = payload.socket_id
  const channelName = payload.channel_name
  if (typeof socketId !== 'string' || typeof channelName !== 'string') {
    return json(400, { error: 'socket_id and channel_name are required' })
  }
  if (!isPuzzleChannel(channelName)) {
    return json(403, { error: 'Channel is not a puzzle session' })
  }
  const digest = await hmacSha256Hex(secret, `${socketId}:${channelName}`)
  return json(200, { auth: `${appKey}:${digest}` })
}

async function authBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string> {
  const body = init?.body
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (input instanceof Request) return input.clone().text()
  return ''
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  )
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function json(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
