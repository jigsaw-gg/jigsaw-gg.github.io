import { createContext } from 'react'

type BackHandler = () => void

export type TelegramUiContextValue = {
  setBackHandler: (handler: BackHandler | null) => void
}

export const TelegramUiContext = createContext<TelegramUiContextValue | null>(
  null,
)
