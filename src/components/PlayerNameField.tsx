import { useI18n } from '../i18n/useI18n.ts'
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
  const { messages } = useI18n()
  return (
    <label className="field">
      <span>{messages.player.name}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="nickname"
        autoFocus={autoFocus}
        maxLength={MAX_PLAYER_NAME_LENGTH}
        spellCheck={false}
      />
      <p className="field__hint">{messages.player.hint}</p>
    </label>
  )
}
