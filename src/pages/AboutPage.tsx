import { useState } from 'react'
import { useI18n } from '../i18n/useI18n.ts'

export function AboutPage() {
  const { messages } = useI18n()
  const [commitOpen, setCommitOpen] = useState(false)
  const commit = import.meta.env.VITE_BUILD_COMMIT
  const commitLog = import.meta.env.VITE_BUILD_COMMIT_LOG
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
    </main>
  )
}
