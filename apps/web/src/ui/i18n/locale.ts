import { en } from './en.ts'
import { es } from './es.ts'
import { ru } from './ru.ts'
import type { Messages } from './types.ts'

export const LOCALES = ['en', 'es', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_STORAGE_KEY = 'jigsaw-gg-locale'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  ru: 'Русский',
}

const CATALOGS: Record<Locale, Messages> = { en, es, ru }

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale]
}

export function matchLocale(tag: string): Locale | null {
  const base = tag.toLowerCase().split('-')[0]
  if (base === 'en' || base === 'es' || base === 'ru') return base
  return null
}

export function detectBrowserLocale(
  languages: readonly string[] = navigator.languages?.length
    ? navigator.languages
    : [navigator.language],
): Locale {
  for (const tag of languages) {
    if (!tag) continue
    const match = matchLocale(tag)
    if (match) return match
  }
  return 'en'
}

export function readLocalePreference(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored && isLocale(stored)) return stored
  } catch {
    // ignore quota / privacy mode errors
  }
  return null
}

export function writeLocalePreference(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // ignore quota / privacy mode errors
  }
}

export function resolveInitialLocale(): Locale {
  return readLocalePreference() ?? detectBrowserLocale()
}
