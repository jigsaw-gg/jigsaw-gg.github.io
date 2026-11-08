import type { ConnectionState } from '@apinator/client'
import { connectionLabel, connectionTone } from '../connectionStatus.ts'

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const label = connectionLabel(state)
  return (
    <span
      className={`conn-pill conn-pill--${connectionTone(state)}`}
      role="status"
      aria-label={`Apinator ${label}`}
    >
      {label}
    </span>
  )
}
