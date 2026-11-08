import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import {
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
  type ThemePreference,
  writeThemePreference,
} from '../theme.ts'

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
    applyResolvedTheme(resolveTheme(preference))
    writeThemePreference(preference)

    if (preference !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyResolvedTheme(resolveTheme('system'))
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
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
