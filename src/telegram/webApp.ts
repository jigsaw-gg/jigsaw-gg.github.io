import WebAppImport from '@twa-dev/sdk'
import type { ResolvedTheme } from '../theme.ts'
import { normalizePlayerName } from '../playerName.ts'
import {
  telegramBotUsername,
  telegramMiniAppShortName,
  telegramMiniAppTitle,
} from './config.ts'

type TelegramWebApp = typeof WebAppImport

/**
 * Vite’s CJS interop can nest `@twa-dev/sdk`’s default export (`{ default: WebApp }`),
 * so `import WebApp from '@twa-dev/sdk'` may be the module namespace in production.
 * Prefer a value that actually exposes `initData`, then the window object the SDK sets.
 */
function resolveTelegramWebApp(imported: TelegramWebApp): TelegramWebApp {
  if (imported && typeof imported.initData === 'string') return imported
  const nested = (imported as unknown as { default?: TelegramWebApp }).default
  if (nested && typeof nested.initData === 'string') return nested
  const injected = (
    window as Window & { Telegram?: { WebApp?: TelegramWebApp } }
  ).Telegram?.WebApp
  if (injected && typeof injected.initData === 'string') return injected
  return imported
}

const WebApp = resolveTelegramWebApp(WebAppImport)

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
  /** Full page URL as seen by the Mini App (Telegram usually puts params in the hash). */
  href: string
  search: string
  hash: string
  /**
   * Launch params Telegram injects (`tgWebApp*`), merged from the current URL
   * and the SDK’s stored `Telegram.WebView.initParams` / sessionStorage copy.
   */
  urlLaunchParams: Array<{ key: string; value: string }>
}

type TelegramWebViewWindow = Window & {
  Telegram?: {
    WebView?: {
      initParams?: Record<string, string | null | undefined>
    }
  }
}

function urlSafeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'))
  } catch {
    return value
  }
}

/** Mirror Telegram’s hash parser so About can show what the client actually got. */
function parseTelegramHashParams(
  locationHash: string,
): Record<string, string | null> {
  const params: Record<string, string | null> = {}
  const raw = locationHash.replace(/^#/, '')
  if (!raw.length) return params
  if (!raw.includes('=') && !raw.includes('?')) {
    params._path = urlSafeDecode(raw)
    return params
  }
  let query = raw
  const qIndex = raw.indexOf('?')
  if (qIndex >= 0) {
    params._path = urlSafeDecode(raw.slice(0, qIndex))
    query = raw.slice(qIndex + 1)
  }
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const name = urlSafeDecode(eq < 0 ? part : part.slice(0, eq))
    const value = eq < 0 ? null : urlSafeDecode(part.slice(eq + 1))
    params[name] = value
  }
  return params
}

function isTelegramLaunchParamKey(key: string): boolean {
  return key.startsWith('tgWebApp') || key === '_path'
}

/** Collect Telegram launch params from URL + SDK storage (hash often cleared after navigate). */
export function readTelegramUrlLaunchParams(): Record<string, string | null> {
  const merged: Record<string, string | null> = {}

  try {
    const stored = sessionStorage.getItem('__telegram__initParams')
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsed)) {
        if (!isTelegramLaunchParamKey(key)) continue
        merged[key] = value == null ? null : String(value)
      }
    }
  } catch {
    // ignore storage / JSON errors
  }

  try {
    const initParams = (window as TelegramWebViewWindow).Telegram?.WebView
      ?.initParams
    if (initParams) {
      for (const [key, value] of Object.entries(initParams)) {
        if (!isTelegramLaunchParamKey(key)) continue
        merged[key] = value == null ? null : String(value)
      }
    }
  } catch {
    // ignore
  }

  try {
    for (const [key, value] of new URLSearchParams(window.location.search)) {
      if (!isTelegramLaunchParamKey(key)) continue
      merged[key] = value
    }
  } catch {
    // ignore
  }

  try {
    for (const [key, value] of Object.entries(
      parseTelegramHashParams(window.location.hash),
    )) {
      if (!isTelegramLaunchParamKey(key)) continue
      merged[key] = value
    }
  } catch {
    // ignore
  }

  return merged
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
  const fromUrl = readTelegramUrlLaunchParams().tgWebAppStartParam?.trim()
  return fromUrl || null
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
  const urlLaunch = readTelegramUrlLaunchParams()
  const tgWebAppStartParam = urlLaunch.tgWebAppStartParam ?? null
  const urlLaunchParams = Object.keys(urlLaunch)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      value: urlLaunch[key] ?? '',
    }))
  return {
    miniApp: isTelegramMiniApp(),
    platform: WebApp.platform,
    version: WebApp.version,
    colorScheme: WebApp.colorScheme,
    startParam: WebApp.initDataUnsafe?.start_param ?? null,
    tgWebAppStartParam,
    initDataLength: WebApp.initData?.length ?? 0,
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
    href: window.location.href,
    search: window.location.search,
    hash: window.location.hash,
    urlLaunchParams,
  }
}

export { WebApp }
