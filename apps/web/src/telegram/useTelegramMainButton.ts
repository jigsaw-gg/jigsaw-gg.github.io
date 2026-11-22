import { useEffect, useRef } from 'react'
import { isTelegramMiniApp, WebApp } from './webApp.ts'

export function useTelegramMainButton(options: {
  text: string
  visible: boolean
  enabled: boolean
  onClick: () => void
}): void {
  const onClickRef = useRef(options.onClick)
  useEffect(() => {
    onClickRef.current = options.onClick
  }, [options.onClick])

  useEffect(() => {
    if (!isTelegramMiniApp()) return
    const button = WebApp.MainButton
    const onClick = () => onClickRef.current()
    button.onClick(onClick)
    return () => {
      button.offClick(onClick)
      button.hide()
    }
  }, [])

  useEffect(() => {
    if (!isTelegramMiniApp()) return
    const button = WebApp.MainButton
    if (!options.visible) {
      button.hide()
      return
    }
    button.setText(options.text)
    if (options.enabled) button.enable()
    else button.disable()
    button.show()
  }, [options.text, options.visible, options.enabled])
}
