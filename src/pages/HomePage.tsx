import {
  APINATOR_APP_KEY,
  APINATOR_CHANNEL,
  APINATOR_CLUSTER,
  APINATOR_EVENT,
  APINATOR_MOCK,
  type ApinatorSnapshot,
} from '../apinator.ts'
import { connectionLabel, connectionTone } from '../connectionStatus.ts'

function formatData(data: unknown): string {
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString()
}

function subscriptionLabel(status: ApinatorSnapshot): string {
  if (status.subscription === 'error') return 'Failed'
  if (status.subscription === 'subscribed' && status.state === 'connected') {
    return 'Subscribed'
  }
  if (status.state === 'connected') return 'Subscribing'
  return 'Waiting for connection'
}

export function HomePage({ status }: { status: ApinatorSnapshot }) {
  const tone = connectionTone(status.state)
  return (
    <main className="page">
      <h1>Jigsaw</h1>
      <p className="lede">
        Placeholder home for jigsaw-gg.github.io. Navigation and the theme
        switch are wired up; puzzle browsing comes later.
      </p>

      <section className="status-card" aria-live="polite">
        <div className="status-card__header">
          <h2>Apinator</h2>
          <span className={`badge badge--${tone}`}>
            {connectionLabel(status.state)}
          </span>
        </div>
        <dl className="facts">
          <div>
            <dt>Cluster</dt>
            <dd>{APINATOR_CLUSTER}</dd>
          </div>
          <div>
            <dt>Channel</dt>
            <dd>
              <code>{APINATOR_CHANNEL}</code>
            </dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>
              <code>{APINATOR_EVENT}</code>
            </dd>
          </div>
          <div>
            <dt>Subscription</dt>
            <dd>{subscriptionLabel(status)}</dd>
          </div>
          <div>
            <dt>Socket</dt>
            <dd>{status.socketId ?? '—'}</dd>
          </div>
          <div>
            <dt>App key</dt>
            <dd>
              <code>
                {APINATOR_APP_KEY ||
                  (APINATOR_MOCK ? 'Development mock' : 'Not configured')}
              </code>
            </dd>
          </div>
        </dl>

        {status.error && (
          <div className="banner banner--error" role="alert">
            <p>{status.error}</p>
          </div>
        )}

        <h3 className="status-card__subtitle">Recent my-event messages</h3>
        {status.events.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          <ul className="event-list">
            {status.events.map((event) => (
              <li key={event.id}>
                <p className="event-list__time">{formatTime(event.at)}</p>
                <pre className="payload">{formatData(event.data)}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
