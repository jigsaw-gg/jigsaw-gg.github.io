import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nProvider.tsx'
import {
  bootstrapTelegramWebApp,
  readTelegramColorScheme,
} from './telegram/webApp.ts'
import {
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
} from './theme.ts'
import './index.css'

bootstrapTelegramWebApp()
if (readThemePreference() === 'system') {
  const telegramTheme = readTelegramColorScheme()
  applyResolvedTheme(telegramTheme ?? resolveTheme('system'))
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
