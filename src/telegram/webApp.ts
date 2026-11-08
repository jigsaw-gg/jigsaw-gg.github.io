import WebApp from '@twa-dev/sdk'
import type { ResolvedTheme } from '../theme.ts'
import { normalizePlayerName } from '../playerName.ts'
import {
  telegramBotUsername,
  telegramMiniAppShortName,
  telegramMiniAppTitle,
} from './config.ts'

export type TelegramDebugInfo = {
  miniApp: boolean
  platform: string
  version: string
  colorScheme: string
  startParam: string | null
  tgWebAppStartParam: string | null
  initDataLength: number
  userId: number | null
  username: string | null
  firstName: string | null
  lastName: string | null
  languageCode: string | null
  botUsername: string
  miniAppShortName: string
  miniAppTitle: string
  viewportHeight: number
  isExpanded: boolean
}

let bootstrapped = false

/** True when Telegram injected signed Mini App init data. */
export function isTelegramMiniApp(): boolean {
  return Boolean(WebApp.initData)
}

export function bootstrapTelegramWebApp(): void {
  if (bootstrapped) return
  bootstrapped = true
  if (!isTelegramMiniApp()) return
  WebApp.ready()
  WebApp.expand()
  try {
    WebApp.disableVerticalSwipes()
  } catch {
    // Older clients omit this method.
  }
}

export function readTelegramStartParam(): string | null {
  const fromSdk = WebApp.initDataUnsafe?.start_param?.trim()
  if (fromSdk) return fromSdk
  try {
    const fromQuery = new URLSearchParams(window.location.search).get(
      'tgWebAppStartParam',
    )
    const trimmed = fromQuery?.trim()
    return trimmed || null
  } catch {
    return null
  }
}

export function readTelegramColorScheme(): ResolvedTheme | null {
  if (!isTelegramMiniApp()) return null
  return WebApp.colorScheme === 'dark' ? 'dark' : 'light'
}

export function subscribeTelegramTheme(
  onChange: (theme: ResolvedTheme) => void,
): () => void {
  if (!isTelegramMiniApp()) return () => {}
  const handler = () => {
    onChange(WebApp.colorScheme === 'dark' ? 'dark' : 'light')
  }
  WebApp.onEvent('themeChanged', handler)
  return () => WebApp.offEvent('themeChanged', handler)
}

/** Prefer Telegram profile name when the browser has no saved player name. */
export function telegramSuggestedPlayerName(): string {
  if (!isTelegramMiniApp()) return ''
  const user = WebApp.initDataUnsafe?.user
  if (!user) return ''
  const parts = [user.first_name, user.last_name].filter(
    (part): part is string => Boolean(part && part.trim()),
  )
  return normalizePlayerName(parts.join(' ')) ?? ''
}

export function hapticImpact(
  style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light',
): void {
  if (!isTelegramMiniApp()) return
  try {
    WebApp.HapticFeedback.impactOccurred(style)
  } catch {
    // ignore missing haptic support
  }
}

export function hapticNotification(
  type: 'error' | 'success' | 'warning',
): void {
  if (!isTelegramMiniApp()) return
  try {
    WebApp.HapticFeedback.notificationOccurred(type)
  } catch {
    // ignore missing haptic support
  }
}

export function hapticSelection(): void {
  if (!isTelegramMiniApp()) return
  try {
    WebApp.HapticFeedback.selectionChanged()
  } catch {
    // ignore missing haptic support
  }
}

export function readTelegramDebugInfo(): TelegramDebugInfo {
  const user = WebApp.initDataUnsafe?.user
  let tgWebAppStartParam: string | null
  try {
    tgWebAppStartParam = new URLSearchParams(window.location.search).get(
      'tgWebAppStartParam',
    )
  } catch {
    tgWebAppStartParam = null
  }
  return {
    miniApp: isTelegramMiniApp(),
    platform: WebApp.platform,
    version: WebApp.version,
    colorScheme: WebApp.colorScheme,
    startParam: WebApp.initDataUnsafe?.start_param ?? null,
    tgWebAppStartParam,
    initDataLength: WebApp.initData.length,
    userId: user?.id ?? null,
    username: user?.username ?? null,
    firstName: user?.first_name ?? null,
    lastName: user?.last_name ?? null,
    languageCode: user?.language_code ?? null,
    botUsername: telegramBotUsername(),
    miniAppShortName: telegramMiniAppShortName(),
    miniAppTitle: telegramMiniAppTitle(),
    viewportHeight: WebApp.viewportHeight,
    isExpanded: WebApp.isExpanded,
  }
}

export { WebApp }
