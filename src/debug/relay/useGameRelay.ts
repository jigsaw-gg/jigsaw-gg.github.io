import { useCallback, useSyncExternalStore } from 'react'
import {
  getGameRelaySnapshot,
  sendPing,
  setAutoPing,
  startGameRelay,
  subscribeGameRelay,
} from './gameRelay.ts'
import type { RelaySnapshot } from './types.ts'

export interface UseGameRelayResult extends RelaySnapshot {
  sendPing: () => void
  setAutoPing: (enabled: boolean) => void
  reconnect: () => void
}

export function useGameRelay(): UseGameRelayResult {
  const snapshot = useSyncExternalStore(
    subscribeGameRelay,
    getGameRelaySnapshot,
  )

  const onSendPing = useCallback(() => {
    void sendPing()
  }, [])

  const onSetAutoPing = useCallback((enabled: boolean) => {
    setAutoPing(enabled)
  }, [])

  const onReconnect = useCallback(() => {
    startGameRelay()
  }, [])

  return {
    ...snapshot,
    sendPing: onSendPing,
    setAutoPing: onSetAutoPing,
    reconnect: onReconnect,
  }
}
