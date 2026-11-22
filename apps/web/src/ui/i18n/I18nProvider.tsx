import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { I18nContext } from './context.ts'
import {
  messagesFor,
  resolveInitialLocale,
  writeLocalePreference,
  type Locale,
} from './locale.ts'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale)
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    writeLocalePreference(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo(
    () => ({ locale, setLocale, messages: messagesFor(locale) }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
