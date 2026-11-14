import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getPlayTransport,
  getPuzzleSessionId,
  otelConfigured,
  subscribePlayTransport,
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
  const transport = useSyncExternalStore(
    subscribePlayTransport,
    getPlayTransport,
    () => null,
  )
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (import.meta.env.PROD || !otelConfigured()) return null

  function show() {
    const dialog = dialogRef.current
    if (!dialog) return
    setOpen(true)
    dialog.showModal()
  }

  function hide() {
    dialogRef.current?.close()
  }

  async function copy(label: string, value: string | null) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
    } catch {
      setCopied(null)
    }
  }

  const rows: { key: string; label: string; value: string | null }[] = [
    { key: 'tab', label: 'tab', value: TAB_ID },
    { key: 'session', label: 'session', value: sessionId },
    { key: 'transport', label: 'transport', value: transport },
  ]

  return (
    <>
      <button
        type="button"
        className="otel-debug"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="OpenTelemetry debug ids"
        title="Open debug ids"
        onClick={show}
      >
        {rows.map((row) => (
          <span key={row.key} className="otel-debug__row">
            <span className="otel-debug__key">{row.label}</span>
            <code className="otel-debug__val">{row.value ?? '—'}</code>
          </span>
        ))}
      </button>
      <dialog
        ref={dialogRef}
        className="otel-debug-dialog"
        aria-labelledby="otel-debug-dialog-title"
        onClose={() => {
          setOpen(false)
          setCopied(null)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) hide()
        }}
      >
        <div className="otel-debug-dialog__panel">
          <h2 id="otel-debug-dialog-title">OTEL debug ids</h2>
          <p className="otel-debug-dialog__lede">
            Select or copy ids for OpenObserve filters.
          </p>
          <div className="otel-debug-dialog__rows">
            {rows.map((row) => (
              <div key={row.key} className="otel-debug-dialog__row">
                <span className="otel-debug-dialog__key">{row.label}</span>
                <input
                  className="otel-debug-dialog__input"
                  readOnly
                  value={row.value ?? ''}
                  placeholder="—"
                  aria-label={row.label}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="button otel-debug-dialog__copy"
                  disabled={!row.value}
                  onClick={() => void copy(row.key, row.value)}
                >
                  {copied === row.key ? 'Copied' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
          <div className="otel-debug-dialog__actions">
            <button type="button" className="button" onClick={hide}>
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
