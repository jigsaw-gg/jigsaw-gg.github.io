export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'jigsaw-gg-theme'

export function isThemePreference(value: string): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored && isThemePreference(stored)) return stored
  } catch {
    // ignore quota / privacy mode errors
  }
  return 'system'
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // ignore quota / privacy mode errors
  }
}

export function getSystemTheme(): ResolvedTheme {
  // Lazy import avoided: callers in Mini App pass Telegram scheme via
  // ThemeSwitcher / subscribeTelegramTheme. Browser fallback only here.
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  // Prefer Telegram's scheme when ThemeSwitcher wires it; this helper stays
  // browser-only for early paint / non-React callers.
  return preference === 'system' ? getSystemTheme() : preference
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
