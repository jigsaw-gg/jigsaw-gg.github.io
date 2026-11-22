/**
 * BotFather Mini App identity.
 *
 * TODO(env): move these fully to `.env` / CI (`VITE_TELEGRAM_BOT_USERNAME`,
 * `VITE_TELEGRAM_MINI_APP_SHORT_NAME`, optional title). Local `config.json`
 * already overrides via Vite; keep these defaults only as the last fallback.
 */
export const DEFAULT_TELEGRAM_BOT_USERNAME = 'Jigsaw_GG_Bot'
export const DEFAULT_TELEGRAM_MINI_APP_SHORT_NAME = 'tg_miniapp'
export const DEFAULT_TELEGRAM_MINI_APP_TITLE = 'Jigsaw GG'

export function telegramBotUsername(): string {
  return (
    import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.trim() ||
    DEFAULT_TELEGRAM_BOT_USERNAME
  )
}

export function telegramMiniAppShortName(): string {
  return (
    import.meta.env.VITE_TELEGRAM_MINI_APP_SHORT_NAME?.trim() ||
    DEFAULT_TELEGRAM_MINI_APP_SHORT_NAME
  )
}

export function telegramMiniAppTitle(): string {
  return (
    import.meta.env.VITE_TELEGRAM_MINI_APP_TITLE?.trim() ||
    DEFAULT_TELEGRAM_MINI_APP_TITLE
  )
}

/** Deep link that opens the Mini App and passes the session as startapp. */
export function playTelegramInviteUrl(sessionId: string): string {
  const bot = telegramBotUsername()
  const app = telegramMiniAppShortName()
  return `https://t.me/${bot}/${app}?startapp=${encodeURIComponent(sessionId)}`
}
