import { useI18n } from '../i18n/useI18n.ts'
import { useGameRelay } from '../relay/useGameRelay.ts'
import type { RelayStatus } from '../relay/types.ts'

function relayStatusLabel(
  status: RelayStatus,
  messages: ReturnType<typeof useI18n>['messages']['about'],
): string {
  switch (status) {
    case 'connecting':
      return messages.relayStatusConnecting
    case 'connected':
      return messages.relayStatusConnected
    case 'disconnected':
      return messages.relayStatusDisconnected
    case 'failed':
      return messages.relayStatusFailed
  }
}

function relayTone(status: RelayStatus): 'ok' | 'wait' | 'bad' {
  if (status === 'connected') return 'ok'
  if (status === 'connecting') return 'wait'
  return 'bad'
}

function formatLogTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(locale)
}

export function NetworkStatusPage() {
  const { locale, messages } = useI18n()
  const text = messages.network
  const about = messages.about
  const relay = useGameRelay()
  const tone = relayTone(relay.status)

  return (
    <main className="page">
      <h1>{text.title}</h1>
      <p className="lede">{text.lede}</p>

      <section className="status-card about-relay" aria-live="polite">
        <div className="status-card__header">
          <h2>{about.relayTitle}</h2>
          <span className={`badge badge--${tone}`}>
            {relayStatusLabel(relay.status, about)}
          </span>
        </div>
        <dl className="facts">
          <div>
            <dt>{about.relayTransport}</dt>
            <dd>
              {relay.transportType
                ? relay.transportType === 'webtransport'
                  ? 'WebTransport'
                  : 'WebSocket'
                : about.relayTransportNone}
            </dd>
          </div>
          <div>
            <dt>{about.relayStatus}</dt>
            <dd>{relayStatusLabel(relay.status, about)}</dd>
          </div>
          <div>
            <dt>{about.relayLatency}</dt>
            <dd>
              {relay.latencyMs === null
                ? about.relayLatencyNone
                : `${relay.latencyMs} ms`}
            </dd>
          </div>
          <div>
            <dt>{about.relayWebTransportUrl}</dt>
            <dd>
              <code>{relay.webtransportUrl}</code>
            </dd>
          </div>
          <div>
            <dt>{about.relayWebSocketUrl}</dt>
            <dd>
              <code>{relay.websocketUrl}</code>
            </dd>
          </div>
        </dl>

        {relay.error ? (
          <div className="banner banner--error" role="alert">
            <p>{relay.error}</p>
          </div>
        ) : null}

        <div className="about-relay__actions">
          <button
            type="button"
            className="button"
            onClick={relay.sendPing}
            disabled={relay.status !== 'connected'}
          >
            {about.relaySendPing}
          </button>
          <button type="button" className="button" onClick={relay.reconnect}>
            {about.relayReconnect}
          </button>
          <label className="about-relay__auto">
            <input
              type="checkbox"
              checked={relay.autoPing}
              onChange={(event) => relay.setAutoPing(event.target.checked)}
              disabled={relay.status !== 'connected'}
            />
            {about.relayAutoPing}
          </label>
        </div>

        <h3 className="status-card__subtitle">{about.relayLog}</h3>
        {relay.messages.length === 0 ? (
          <p className="muted">{about.relayLogEmpty}</p>
        ) : (
          <ul className="event-list about-relay__log">
            {relay.messages.map((entry) => (
              <li key={entry.id}>
                <p className="event-list__time">
                  {formatLogTime(entry.at, locale)} · {entry.direction}
                </p>
                <pre className="payload">{entry.text}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
