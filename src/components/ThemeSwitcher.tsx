import { useEffect, useState } from 'react'
import {
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
  type ThemePreference,
  writeThemePreference,
} from '../theme.ts'

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeSwitcher() {
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
    <div className="theme-switcher" role="group" aria-label="Color theme">
      {OPTIONS.map((option) => (
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
