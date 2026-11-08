import { useState } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import { playTelegramInviteUrl } from '../telegram/config.ts'
import { readTelegramDebugInfo } from '../telegram/webApp.ts'

export function AboutPage() {
  const { messages } = useI18n()
  const [commitOpen, setCommitOpen] = useState(false)
  const commit = import.meta.env.VITE_BUILD_COMMIT
  const commitLog = import.meta.env.VITE_BUILD_COMMIT_LOG
  const telegram = readTelegramDebugInfo()
  const sampleInvite = playTelegramInviteUrl('sampleSessionId012345')
  return (
    <main className="page">
      <h1>{messages.about.title}</h1>
      <p className="lede">{messages.about.lede}</p>
      {commit ? (
        <p className="about-version">
          <span className="about-version__label">{messages.about.version}</span>{' '}
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
            {commitOpen ? messages.about.commitHide : messages.about.commitShow}
          </button>
        </div>
      ) : null}
      <section
        className="about-telegram"
        aria-label={messages.about.telegramDebug}
      >
        <h2>{messages.about.telegramDebug}</h2>
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
        </dl>
      </section>
    </main>
  )
}
