export type EmbeddedSafariSignals = {
  userAgent: string
  platform: string
  maxTouchPoints: number
  telegramProxy: boolean
}

const IOS_DEVICE = /iPhone|iPad|iPod/

// Tokens these apps append when a page is open in their iOS web view.
const EMBEDDED_WEBKIT =
  /\bInstagram|\bFB[\w_]+\/|\bFacebook|\bFB_IAB|\bFBAN|\bTwitter|\bLine\/|\bMicroMessenger\/|\bBarcelona|musical_ly|Bytedance(?:Webview)?|Snapchat|LinkedInApp|\bGSA\/|\bWAiOS\//i

function isIosWebKitDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  if (IOS_DEVICE.test(userAgent)) return true
  // iPadOS reports a Macintosh user agent. Touch points keep a desktop Mac out.
  return (
    platform === 'MacIntel' && maxTouchPoints > 1 && /Macintosh/.test(userAgent)
  )
}

export function isEmbeddedMobileSafari(
  signals: EmbeddedSafariSignals,
): boolean {
  if (
    !isIosWebKitDevice(
      signals.userAgent,
      signals.platform,
      signals.maxTouchPoints,
    )
  ) {
    return false
  }
  // Telegram's iOS web view keeps a Safari user agent and injects this proxy.
  if (signals.telegramProxy) return true
  if (EMBEDDED_WEBKIT.test(signals.userAgent)) return true
  // A bare WKWebView omits "Safari/". Mobile Safari and the iOS browser ports keep it.
  return (
    /AppleWebKit/i.test(signals.userAgent) &&
    !/Safari\//.test(signals.userAgent)
  )
}

export function readEmbeddedSafariSignals(): EmbeddedSafariSignals {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    telegramProxy:
      'TelegramWebviewProxy' in window || 'TelegramWebviewProxyProto' in window,
  }
}
