import type { ConnectionState } from '@apinator/client'

export type ConnectionTone = 'ok' | 'wait' | 'bad'

export function connectionTone(state: ConnectionState): ConnectionTone {
  if (state === 'connected') return 'ok'
  if (state === 'disconnected' || state === 'unavailable') return 'bad'
  return 'wait'
}

export interface ConnectionLabels {
  starting: string
  connecting: string
  connected: string
  disconnected: string
  unavailable: string
}

export function connectionLabel(
  state: ConnectionState,
  labels: ConnectionLabels,
): string {
  switch (state) {
    case 'initialized':
      return labels.starting
    case 'connecting':
      return labels.connecting
    case 'connected':
      return labels.connected
    case 'disconnected':
      return labels.disconnected
    case 'unavailable':
      return labels.unavailable
  }
}
