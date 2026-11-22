export type RelayTransport = 'webtransport' | 'websocket'

export type RelayStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

export interface RelayLogEntry {
  id: number
  at: string
  direction: 'in' | 'out' | 'info'
  text: string
}

export interface RelaySnapshot {
  transportType: RelayTransport | null
  status: RelayStatus
  latencyMs: number | null
  messages: readonly RelayLogEntry[]
  error: string | null
  autoPing: boolean
  webtransportUrl: string
  websocketUrl: string
}
