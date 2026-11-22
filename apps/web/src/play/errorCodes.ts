/** Stable error tokens for ui localization (`localizeError`). */
const MARK = '@@i18n:'

export type PlayErrorCode = 'appKeyMissing' | 'connection' | 'channelJoin'

export function playError(code: PlayErrorCode): string {
  return `${MARK}${code}`
}

export function isPlayErrorToken(value: string): boolean {
  return value.startsWith(MARK)
}

export function playErrorCode(value: string): string {
  return value.startsWith(MARK) ? value.slice(MARK.length) : value
}
