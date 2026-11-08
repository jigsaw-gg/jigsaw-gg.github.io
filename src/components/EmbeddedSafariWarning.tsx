import { useEffect, useRef, useState } from 'react'
import {
  isEmbeddedMobileSafari,
  readEmbeddedSafariSignals,
} from '../embeddedSafari.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { isTelegramMiniApp } from '../telegram/webApp.ts'

export function EmbeddedSafariWarning() {
  const { messages } = useI18n()
  const [embedded] = useState(() => {
    // Mini App is intentional; do not nudge users toward Safari.
    if (isTelegramMiniApp()) return false
    return isEmbeddedMobileSafari(readEmbeddedSafariSignals())
  })
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const apply = () => {
      document.documentElement.style.setProperty(
        '--embedded-safari-space',
        `${node.offsetHeight}px`,
      )
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--embedded-safari-space')
    }
  }, [embedded])

  if (!embedded) return null

  return (
    <p ref={ref} className="embedded-safari" role="status">
      {messages.fullscreen.embeddedSafari}
    </p>
  )
}
