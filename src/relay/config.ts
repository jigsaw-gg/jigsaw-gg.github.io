const DEFAULT_WEBTRANSPORT_URL = 'https://jigsaw-gg.duckdns.org:31100/relay'
const DEFAULT_WEBSOCKET_URL = 'ws://jigsaw-gg.duckdns.org:21100/ws'
const DEFAULT_ROOM = 'default'

function readEnv(name: keyof ImportMetaEnv): string {
  const raw = import.meta.env[name]
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (value === '' || value === 'undefined' || value === 'null') return ''
  return value
}

/** Ensure `room` is present so the server joins a known broadcast room. */
export function withRoom(url: string, room = DEFAULT_ROOM): string {
  const parsed = new URL(url)
  if (!parsed.searchParams.get('room')) {
    parsed.searchParams.set('room', room)
  }
  return parsed.toString()
}

export const RELAY_WEBTRANSPORT_URL = withRoom(
  readEnv('VITE_RELAY_WEBTRANSPORT_URL') || DEFAULT_WEBTRANSPORT_URL,
)

export const RELAY_WEBSOCKET_URL = withRoom(
  readEnv('VITE_RELAY_WEBSOCKET_URL') || DEFAULT_WEBSOCKET_URL,
)

export const RELAY_ROOM =
  new URL(RELAY_WEBTRANSPORT_URL).searchParams.get('room') || DEFAULT_ROOM
