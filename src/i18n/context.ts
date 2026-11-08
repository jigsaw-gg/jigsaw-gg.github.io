import { createContext } from 'react'
import type { Locale } from './locale.ts'
import type { Messages } from './types.ts'

export interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  messages: Messages
}

export const I18nContext = createContext<I18nValue | null>(null)
