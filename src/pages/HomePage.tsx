import {
  APINATOR_APP_KEY,
  APINATOR_CHANNEL,
  APINATOR_CLUSTER,
  APINATOR_EVENT,
  APINATOR_MOCK,
  type ApinatorSnapshot,
} from '../apinator.ts'
import { connectionLabel, connectionTone } from '../connectionStatus.ts'
import { localizeError } from '../i18n/errors.ts'
import type { Messages } from '../i18n/types.ts'
import { useI18n } from '../i18n/useI18n.ts'

function formatData(data: unknown): string {
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function formatTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(locale)
}

function subscriptionLabel(
  status: ApinatorSnapshot,
  text: Messages['home'],
): string {
  if (status.subscription === 'error') return text.failed
  if (status.subscription === 'subscribed' && status.state === 'connected') {
    return text.subscribed
  }
  if (status.state === 'connected') return text.subscribing
  return text.waiting
}

export function HomePage({ status }: { status: ApinatorSnapshot }) {
  const { locale, messages } = useI18n()
  const text = messages.home
  const tone = connectionTone(status.state)
  return (
    <main className="page">
      <h1>{text.title}</h1>
      <p className="lede">{text.lede}</p>

      <section className="status-card" aria-live="polite">
        <div className="status-card__header">
          <h2>Apinator</h2>
          <span className={`badge badge--${tone}`}>
            {connectionLabel(status.state, messages.connection)}
          </span>
        </div>
        <dl className="facts">
          <div>
            <dt>{text.cluster}</dt>
            <dd>{APINATOR_CLUSTER}</dd>
          </div>
          <div>
            <dt>{text.channel}</dt>
            <dd>
              <code>{APINATOR_CHANNEL}</code>
            </dd>
          </div>
          <div>
            <dt>{text.event}</dt>
            <dd>
              <code>{APINATOR_EVENT}</code>
            </dd>
          </div>
          <div>
            <dt>{text.subscription}</dt>
            <dd>{subscriptionLabel(status, text)}</dd>
          </div>
          <div>
            <dt>{text.socket}</dt>
            <dd>{status.socketId ?? '—'}</dd>
          </div>
          <div>
            <dt>{text.appKey}</dt>
            <dd>
              <code>
                {APINATOR_APP_KEY ||
                  (APINATOR_MOCK ? text.mock : text.notConfigured)}
              </code>
            </dd>
          </div>
        </dl>

        {status.error && (
          <div className="banner banner--error" role="alert">
            <p>{localizeError(status.error, messages.errors)}</p>
          </div>
        )}

        <h3 className="status-card__subtitle">{text.recent}</h3>
        {status.events.length === 0 ? (
          <p className="muted">{text.empty}</p>
        ) : (
          <ul className="event-list">
            {status.events.map((event) => (
              <li key={event.id}>
                <p className="event-list__time">
                  {formatTime(event.at, locale)}
                </p>
                <pre className="payload">{formatData(event.data)}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
