import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import {
  readTelegramColorScheme,
  subscribeTelegramTheme,
} from '../telegram/webApp.ts'
import {
  applyResolvedTheme,
  getSystemTheme,
  readThemePreference,
  type ResolvedTheme,
  type ThemePreference,
  writeThemePreference,
} from '../theme.ts'

function resolvePreferredTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return readTelegramColorScheme() ?? getSystemTheme()
}

export function ThemeSwitcher() {
  const { messages } = useI18n()
  const options: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: messages.theme.system },
    { value: 'light', label: messages.theme.light },
    { value: 'dark', label: messages.theme.dark },
  ]
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  )

  useEffect(() => {
    applyResolvedTheme(resolvePreferredTheme(preference))
    writeThemePreference(preference)

    if (preference !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onMedia = () => applyResolvedTheme(resolvePreferredTheme('system'))
    media.addEventListener('change', onMedia)
    const unsubscribeTelegram = subscribeTelegramTheme((theme) => {
      applyResolvedTheme(theme)
    })
    return () => {
      media.removeEventListener('change', onMedia)
      unsubscribeTelegram()
    }
  }, [preference])

  return (
    <div
      className="theme-switcher"
      role="group"
      aria-label={messages.theme.group}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={
            preference === option.value
              ? 'theme-switcher__option theme-switcher__option--active'
              : 'theme-switcher__option'
          }
          aria-pressed={preference === option.value}
          onClick={() => setPreference(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
