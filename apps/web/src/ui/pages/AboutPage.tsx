import { useState, useSyncExternalStore } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import { useGameRelay } from '../../debug/relay/useGameRelay.ts'
import type { RelayStatus } from '../../debug/relay/types.ts'
import { playTelegramInviteUrl } from '../../telegram/config.ts'
import { readTelegramDebugInfo } from '../../telegram/webApp.ts'
import {
  isWebTransportEnabled,
  setWebTransportEnabled,
  subscribeWebTransportEnabled,
} from '../../core/transportPrefs.ts'

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

export function AboutPage() {
  const { locale, messages } = useI18n()
  const [commitOpen, setCommitOpen] = useState(false)
  const commit = import.meta.env.VITE_BUILD_COMMIT
  const commitLog = import.meta.env.VITE_BUILD_COMMIT_LOG
  const telegram = readTelegramDebugInfo()
  const sampleInvite = playTelegramInviteUrl('sampleSessionId012345')
  const relay = useGameRelay()
  const about = messages.about
  const tone = relayTone(relay.status)
  const webTransportEnabled = useSyncExternalStore(
    subscribeWebTransportEnabled,
    isWebTransportEnabled,
    () => true,
  )

  return (
    <main className="page">
      <h1>{about.title}</h1>
      <p className="lede">{about.lede}</p>
      {commit || commitLog ? (
        <section
          className="status-card about-commit-section"
          aria-labelledby="about-commit-title"
        >
          <div className="status-card__header">
            <h2 id="about-commit-title">{about.version}</h2>
          </div>
          {commit ? (
            <p className="about-version">
              <code className="about-version__commit">{commit}</code>
            </p>
          ) : null}
          {commitLog ? (
            <div
              className={
                commitOpen ? 'about-commit about-commit--open' : 'about-commit'
              }
            >
              <pre id="about-commit-log" className="about-commit__log">
                {commitLog}
              </pre>
              <button
                type="button"
                className="button about-commit__toggle"
                aria-expanded={commitOpen}
                aria-controls="about-commit-log"
                onClick={() => setCommitOpen((open) => !open)}
              >
                {commitOpen ? about.commitHide : about.commitShow}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        className="status-card about-options"
        aria-labelledby="about-options-title"
      >
        <div className="status-card__header">
          <h2 id="about-options-title">{about.optionsTitle}</h2>
        </div>
        <div className="about-options__list">
          <label className="about-options__option">
            <input
              type="checkbox"
              checked={webTransportEnabled}
              onChange={(event) => {
                setWebTransportEnabled(event.target.checked)
                relay.reconnect()
              }}
            />
            {about.optionsWebTransport}
          </label>
          <label className="about-options__option">
            <input type="checkbox" checked disabled />
            {about.optionsWebSocket}
          </label>
        </div>
      </section>

      <section
        className="status-card about-relay"
        aria-labelledby="about-relay-title"
        aria-live="polite"
      >
        <div className="status-card__header">
          <h2 id="about-relay-title">{about.relayTitle}</h2>
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

      <section
        className="status-card about-telegram"
        aria-labelledby="about-telegram-title"
      >
        <div className="status-card__header">
          <h2 id="about-telegram-title">{about.telegramDebug}</h2>
        </div>
        <dl className="facts">
          <div>
            <dt>miniApp</dt>
            <dd>{telegram.miniApp ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt>platform</dt>
            <dd>{telegram.platform}</dd>
          </div>
          <div>
            <dt>version</dt>
            <dd>{telegram.version}</dd>
          </div>
          <div>
            <dt>colorScheme</dt>
            <dd>{telegram.colorScheme}</dd>
          </div>
          <div>
            <dt>start_param</dt>
            <dd>
              <code>{telegram.startParam ?? '—'}</code>
            </dd>
          </div>
          <div>
            <dt>tgWebAppStartParam</dt>
            <dd>
              <code>{telegram.tgWebAppStartParam ?? '—'}</code>
            </dd>
          </div>
          <div>
            <dt>initData length</dt>
            <dd>{telegram.initDataLength}</dd>
          </div>
          <div>
            <dt>user</dt>
            <dd>
              <code>
                {telegram.userId === null
                  ? '—'
                  : [
                      telegram.userId,
                      telegram.username && `@${telegram.username}`,
                      [telegram.firstName, telegram.lastName]
                        .filter(Boolean)
                        .join(' '),
                      telegram.languageCode,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </code>
            </dd>
          </div>
          <div>
            <dt>bot</dt>
            <dd>
              <code>
                @{telegram.botUsername}/{telegram.miniAppShortName}
              </code>
            </dd>
          </div>
          <div>
            <dt>title</dt>
            <dd>{telegram.miniAppTitle}</dd>
          </div>
          <div>
            <dt>viewport</dt>
            <dd>
              {Math.round(telegram.viewportHeight)}px
              {telegram.isExpanded ? ' · expanded' : ''}
            </dd>
          </div>
          <div>
            <dt>sample deep link</dt>
            <dd>
              <code>{sampleInvite}</code>
            </dd>
          </div>
          <div>
            <dt>href</dt>
            <dd>
              <code>{telegram.href || '—'}</code>
            </dd>
          </div>
          <div>
            <dt>search</dt>
            <dd>
              <code>{telegram.search || '—'}</code>
            </dd>
          </div>
          <div>
            <dt>hash</dt>
            <dd>
              <code>{telegram.hash || '—'}</code>
            </dd>
          </div>
        </dl>
        <h3 className="status-card__subtitle">{about.telegramUrlParams}</h3>
        {telegram.urlLaunchParams.length === 0 ? (
          <p className="muted">{about.telegramUrlParamsEmpty}</p>
        ) : (
          <dl className="facts about-telegram__url-params">
            {telegram.urlLaunchParams.map(({ key, value }) => (
              <div key={key} className="about-telegram__url-param">
                <dt>{key}</dt>
                <dd>
                  <code>{value || '—'}</code>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </main>
  )
}
