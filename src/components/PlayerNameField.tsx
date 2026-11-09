import { useId } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import { MAX_PLAYER_NAME_LENGTH, suggestPlayerName } from '../playerName.ts'
import { telegramSuggestedPlayerName } from '../telegram/webApp.ts'

export function PlayerNameField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const { locale, messages } = useI18n()
  const inputId = useId()
  const hintId = useId()
  const telegramName = telegramSuggestedPlayerName()
  return (
    <div className="field">
      <label htmlFor={inputId}>
        <span>{messages.player.name}</span>
      </label>
      <span
        className={
          telegramName
            ? 'field__control field__control--with-telegram'
            : 'field__control'
        }
      >
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="nickname"
          autoFocus={autoFocus}
          maxLength={MAX_PLAYER_NAME_LENGTH}
          spellCheck={false}
          aria-describedby={hintId}
        />
        <span className="field__suggest">
          {telegramName ? (
            <button
              type="button"
              className="field__random field__random--telegram"
              title={telegramName}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(telegramName)}
            >
              {telegramName}
            </button>
          ) : null}
          <button
            type="button"
            className="field__random"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(suggestPlayerName(locale))}
          >
            random
          </button>
        </span>
      </span>
      <p id={hintId} className="field__hint">
        {messages.player.hint}
      </p>
    </div>
  )
}
