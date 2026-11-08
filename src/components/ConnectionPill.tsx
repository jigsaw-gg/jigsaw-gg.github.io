import type { ConnectionState } from '@apinator/client'
import { connectionLabel, connectionTone } from '../connectionStatus.ts'
import { useI18n } from '../i18n/useI18n.ts'

export function ConnectionPill({
  state,
  compact = false,
  quiet = false,
}: {
  state: ConnectionState
  compact?: boolean
  quiet?: boolean
}) {
  const { messages } = useI18n()
  const label = connectionLabel(state, messages.connection)
  const className = [
    'conn-pill',
    `conn-pill--${connectionTone(state)}`,
    compact ? 'conn-pill--compact' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span
      className={className}
      role={quiet ? undefined : 'status'}
      aria-hidden={quiet ? true : undefined}
      aria-label={quiet ? undefined : messages.connection.pill(label)}
      title={compact && !quiet ? label : undefined}
    >
      {compact ? null : label}
    </span>
  )
}
