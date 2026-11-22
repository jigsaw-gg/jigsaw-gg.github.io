import { isPlayErrorToken, playErrorCode } from '../../play/errorCodes.ts'
import type { Messages } from './types.ts'

export type I18nErrorCode = keyof Messages['errors']

export function localizeError(
  value: string,
  errors: Messages['errors'],
): string {
  if (!isPlayErrorToken(value)) return value
  const code = playErrorCode(value)
  if (
    code === 'appKeyMissing' ||
    code === 'connection' ||
    code === 'channelJoin'
  ) {
    return errors[code]
  }
  return value
}
