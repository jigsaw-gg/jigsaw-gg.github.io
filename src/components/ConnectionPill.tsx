import type { ConnectionState } from '@apinator/client'
import { connectionLabel, connectionTone } from '../connectionStatus.ts'
import { useI18n } from '../i18n/useI18n.ts'

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const { messages } = useI18n()
  const label = connectionLabel(state, messages.connection)
  return (
    <span
      className={`conn-pill conn-pill--${connectionTone(state)}`}
      role="status"
      aria-label={messages.connection.pill(label)}
    >
      {label}
    </span>
  )
}
