import { useSyncExternalStore } from 'react'
import {
  getPuzzleSessionId,
  otelConfigured,
  subscribePuzzleSessionId,
  TAB_ID,
} from '../otel/index.ts'

/**
 * Local/dev only: shows the same tab + session ids attached to OTEL spans.
 * Hidden for production / GitHub Pages (OTEL endpoint is forced empty there).
 */
export function OtelDebugOverlay() {
  const sessionId = useSyncExternalStore(
    subscribePuzzleSessionId,
    getPuzzleSessionId,
    () => null,
  )

  if (import.meta.env.PROD || !otelConfigured()) return null

  return (
    <aside className="otel-debug" aria-label="OpenTelemetry debug ids">
      <div className="otel-debug__row">
        <span className="otel-debug__key">tab</span>
        <code className="otel-debug__val">{TAB_ID}</code>
      </div>
      <div className="otel-debug__row">
        <span className="otel-debug__key">session</span>
        <code className="otel-debug__val">{sessionId ?? '—'}</code>
      </div>
    </aside>
  )
}
