import { useContext, useEffect, useRef } from 'react'
import { TelegramUiContext } from './TelegramUiContext.ts'

type BackHandler = () => void

export function useTelegramBackHandler(
  handler: BackHandler,
  active: boolean,
): void {
  const context = useContext(TelegramUiContext)
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])
  useEffect(() => {
    if (!context || !active) return
    context.setBackHandler(() => handlerRef.current())
    return () => context.setBackHandler(null)
  }, [context, active])
}
