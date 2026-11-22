/** Match `./manage.sh run-rust-server-local` default bind ports (see `apps/server`). */
const DEFAULT_GAME_HTTP_URL = 'http://127.0.0.1:21100'
const DEFAULT_GAME_WEBTRANSPORT_URL = 'https://127.0.0.1:31100'
const DEFAULT_GAME_WEBSOCKET_URL = 'ws://127.0.0.1:21100'

function readEnv(name: keyof ImportMetaEnv): string {
  const raw = import.meta.env[name]
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (value === '' || value === 'undefined' || value === 'null') return ''
  return value
}

/** Origin only (`scheme://host:port`), path stripped. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

function httpOriginFromWebSocket(url: string): string | null {
  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    return `${protocol}//${parsed.host}`
  } catch {
    return null
  }
}

/**
 * Absolute bases the client dials for play. JoinGame returns path+query only;
 * those paths are resolved against these origins (see proto PlayEndpoints).
 */
export const GAME_WEBTRANSPORT_BASE =
  originOf(readEnv('VITE_GAME_WEBTRANSPORT_URL')) ||
  DEFAULT_GAME_WEBTRANSPORT_URL

export const GAME_WEBSOCKET_BASE =
  originOf(readEnv('VITE_GAME_WEBSOCKET_URL')) || DEFAULT_GAME_WEBSOCKET_URL

export const GAME_HTTP_BASE =
  readEnv('VITE_GAME_HTTP_URL') ||
  httpOriginFromWebSocket(GAME_WEBSOCKET_BASE) ||
  DEFAULT_GAME_HTTP_URL

export const WT_CONNECT_TIMEOUT_MS = 4000
export const HEARTBEAT_INTERVAL_MS = 2500
export const MEMBER_EVERY = 4

/**
 * Server play target → absolute URL on a client-owned base.
 * Accepts path-absolute `/game?…` or (legacy) absolute URLs; host/port from
 * legacy absolutes are discarded.
 */
export function resolvePlayUrl(base: string, pathOrUrl: string): string {
  const relative = toPlayPath(pathOrUrl)
  if (!relative || !base) return ''
  try {
    return new URL(relative, base.endsWith('/') ? base : `${base}/`).toString()
  } catch {
    return ''
  }
}

function toPlayPath(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  if (raw.startsWith('/')) return raw
  try {
    const parsed = new URL(raw)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`
  }
}
