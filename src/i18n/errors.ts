import type { Messages } from './types.ts'

const MARK = '@@i18n:'

export type I18nErrorCode = keyof Messages['errors']

export function i18nError(code: I18nErrorCode): string {
  return `${MARK}${code}`
}

export function localizeError(
  value: string,
  errors: Messages['errors'],
): string {
  if (!value.startsWith(MARK)) return value
  const code = value.slice(MARK.length)
  if (
    code === 'appKeyMissing' ||
    code === 'connection' ||
    code === 'channelJoin'
  ) {
    return errors[code]
  }
  return value
}
