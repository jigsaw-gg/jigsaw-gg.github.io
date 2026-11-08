import type { ConnectionState } from '@apinator/client'

export type ConnectionTone = 'ok' | 'wait' | 'bad'

export function connectionTone(state: ConnectionState): ConnectionTone {
  if (state === 'connected') return 'ok'
  if (state === 'disconnected' || state === 'unavailable') return 'bad'
  return 'wait'
}

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'initialized':
      return 'Starting'
    case 'connecting':
      return 'Connecting'
    case 'connected':
      return 'Connected'
    case 'disconnected':
      return 'Disconnected'
    case 'unavailable':
      return 'Unavailable'
  }
}
