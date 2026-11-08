import { useEffect, useState } from 'react'
import {
  isExpanded,
  isImmersive,
  setImmersive,
  subscribeExpanded,
  toggleExpanded,
} from '../fullscreen.ts'
import { useI18n } from '../i18n/useI18n.ts'

export function FullscreenButton({ className }: { className?: string }) {
  const { messages } = useI18n()
  const [expanded, setExpanded] = useState(isExpanded)

  useEffect(() => subscribeExpanded(() => setExpanded(isExpanded())), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isImmersive()) return
      if (document.querySelector('.topbar--open')) return
      if (document.querySelector('.play-mode:not(.play-mode--inactive)')) {
        return
      }
      setImmersive(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const label = expanded ? messages.fullscreen.exit : messages.fullscreen.enter

  return (
    <button
      type="button"
      className={['fullscreen-button', className].filter(Boolean).join(' ')}
      aria-pressed={expanded}
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => void toggleExpanded()}
    >
      {expanded ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
    </button>
  )
}

function EnterFullscreenIcon() {
  return (
    <svg
      className="fullscreen-button__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <path
        d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ExitFullscreenIcon() {
  return (
    <svg
      className="fullscreen-button__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <path
        d="M9 4v5H4M20 9V4h-5M15 20h5v-5M4 15v5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
