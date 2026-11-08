import { MAX_PLAYER_NAME_LENGTH } from '../playerName.ts'

export function PlayerNameField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  return (
    <label className="field">
      <span>Your name</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="nickname"
        autoFocus={autoFocus}
        maxLength={MAX_PLAYER_NAME_LENGTH}
        spellCheck={false}
      />
      <p className="field__hint">
        Other players in the session will see this name. It is saved in this
        browser and filled in next time.
      </p>
    </label>
  )
}
