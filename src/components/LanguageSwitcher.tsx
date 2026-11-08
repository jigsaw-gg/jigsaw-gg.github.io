import { useRef, useState } from 'react'
import { LOCALE_LABELS, LOCALES, type Locale } from '../i18n/locale.ts'
import { useI18n } from '../i18n/useI18n.ts'

export function LanguageSwitcher({ labeled = false }: { labeled?: boolean }) {
  const { locale, setLocale, messages } = useI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  function show() {
    const dialog = dialogRef.current
    if (!dialog) return
    setOpen(true)
    dialog.showModal()
    dialog
      .querySelector<HTMLButtonElement>('.language-dialog__option--active')
      ?.focus()
  }

  function hide() {
    dialogRef.current?.close()
  }

  function choose(next: Locale) {
    setLocale(next)
    hide()
  }

  return (
    <>
      <button
        type="button"
        className={
          labeled ? 'world-button world-button--labeled' : 'world-button'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={messages.language.button}
        onClick={show}
      >
        <WorldIcon />
        {labeled ? <span>{messages.language.button}</span> : null}
      </button>
      <dialog
        ref={dialogRef}
        className="language-dialog"
        aria-labelledby="language-dialog-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) hide()
        }}
      >
        <div className="language-dialog__panel">
          <h2 id="language-dialog-title">{messages.language.title}</h2>
          <div className="language-dialog__options">
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                className={
                  locale === code
                    ? 'language-dialog__option language-dialog__option--active'
                    : 'language-dialog__option'
                }
                lang={code}
                aria-pressed={locale === code}
                onClick={() => choose(code)}
              >
                {LOCALE_LABELS[code]}
              </button>
            ))}
          </div>
          <div className="language-dialog__actions">
            <button type="button" className="button" onClick={hide}>
              {messages.language.close}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}

function WorldIcon() {
  return (
    <svg
      className="world-button__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="8.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="3.6"
        ry="8.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.75 12h16.5M5.1 8.25h13.8M5.1 15.75h13.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
