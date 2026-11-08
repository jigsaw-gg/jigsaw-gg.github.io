import { useId } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import { MAX_PLAYER_NAME_LENGTH, suggestPlayerName } from '../playerName.ts'

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
  return (
    <div className="field">
      <label htmlFor={inputId}>
        <span>{messages.player.name}</span>
      </label>
      <span className="field__control">
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
        <button
          type="button"
          className="field__random"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(suggestPlayerName(locale))}
        >
          random
        </button>
      </span>
      <p id={hintId} className="field__hint">
        {messages.player.hint}
      </p>
    </div>
  )
}
