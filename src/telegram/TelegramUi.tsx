import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { normalizeSessionId, playInvitePath } from '../puzzle/session.ts'
import { TelegramUiContext } from './TelegramUiContext.ts'
import {
  bootstrapTelegramWebApp,
  isTelegramMiniApp,
  readTelegramStartParam,
  WebApp,
} from './webApp.ts'

type BackHandler = () => void

/** Ready/expand, startapp → /play/?id=, and Telegram BackButton routing. */
export function TelegramUi({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const backHandlerRef = useRef<BackHandler | null>(null)
  const [backOverride, setBackOverride] = useState(false)
  const startRouted = useRef(false)

  const setBackHandler = useCallback((handler: BackHandler | null) => {
    backHandlerRef.current = handler
    setBackOverride(handler !== null)
  }, [])

  useEffect(() => {
    bootstrapTelegramWebApp()
  }, [])

  useEffect(() => {
    if (startRouted.current) return
    startRouted.current = true
    const raw = readTelegramStartParam()
    const id = raw ? normalizeSessionId(raw) : null
    if (!id) return
    if (location.pathname === '/play' && search.get('id') === id) return
    navigate(playInvitePath(id), { replace: true })
  }, [location.pathname, navigate, search])

  useEffect(() => {
    if (!isTelegramMiniApp()) return
    const onBack = () => {
      if (backHandlerRef.current) {
        backHandlerRef.current()
        return
      }
      if (location.pathname !== '/') {
        navigate('/', { replace: true })
      }
    }
    WebApp.BackButton.onClick(onBack)
    return () => {
      WebApp.BackButton.offClick(onBack)
      WebApp.BackButton.hide()
    }
  }, [location.pathname, navigate])

  useEffect(() => {
    if (!isTelegramMiniApp()) return
    const show = backOverride || location.pathname !== '/'
    if (show) WebApp.BackButton.show()
    else WebApp.BackButton.hide()
  }, [backOverride, location.pathname])

  return (
    <TelegramUiContext.Provider value={{ setBackHandler }}>
      {children}
    </TelegramUiContext.Provider>
  )
}
