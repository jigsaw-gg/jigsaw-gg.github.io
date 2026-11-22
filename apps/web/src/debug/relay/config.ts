import {
  GAME_WEBSOCKET_BASE,
  GAME_WEBTRANSPORT_BASE,
} from '../../core/config.ts'

const DEFAULT_ROOM = 'default'
const RELAY_WT_PATH = '/relay'
const RELAY_WS_PATH = '/ws'

/** Ensure `room` is present so the server joins a known broadcast room. */
export function withRoom(url: string, room = DEFAULT_ROOM): string {
  const parsed = new URL(url)
  if (!parsed.searchParams.get('room')) {
    parsed.searchParams.set('room', room)
  }
  return parsed.toString()
}

function joinBasePath(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
}

/** Relay probe URLs — same host/port as play, fixed `/relay` and `/ws` paths. */
export const RELAY_WEBTRANSPORT_URL = withRoom(
  joinBasePath(GAME_WEBTRANSPORT_BASE, RELAY_WT_PATH),
)

export const RELAY_WEBSOCKET_URL = withRoom(
  joinBasePath(GAME_WEBSOCKET_BASE, RELAY_WS_PATH),
)

export const RELAY_ROOM =
  new URL(RELAY_WEBTRANSPORT_URL).searchParams.get('room') || DEFAULT_ROOM
