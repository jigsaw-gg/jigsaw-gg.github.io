import { initOtel, event, withSpan } from './otel/index.ts'
import './index.css'

// OTEL first so networking / input modules that load with App already export.
await initOtel()
event('bootstrap', 'app.document_ready')

const [
  { StrictMode },
  { createRoot },
  { default: App },
  { I18nProvider },
  gamepad,
  { installGamepadUiNav },
  telegram,
  theme,
  { purgeExpiredPuzzleStorage },
] = await Promise.all([
  import('react'),
  import('react-dom/client'),
  import('./App.tsx'),
  import('./ui/i18n/I18nProvider.tsx'),
  import('./input/gamepadHandler.ts'),
  import('./input/gamepadUiNav.ts'),
  import('./telegram/webApp.ts'),
  import('./theme.ts'),
  import('./play/storageTtl.ts'),
])

withSpan('bootstrap', 'app.bootstrap', () => {
  purgeExpiredPuzzleStorage()
  telegram.bootstrapTelegramWebApp()
  if (theme.readThemePreference() === 'system') {
    const telegramTheme = telegram.readTelegramColorScheme()
    theme.applyResolvedTheme(telegramTheme ?? theme.resolveTheme('system'))
  }

  // Same as Slither's handleInstall: start the pad poller as soon as the page loads.
  gamepad.install()
  installGamepadUiNav()
})

if (import.meta.env.DEV) {
  void import('./dev/browserLog.ts').then((mod) => mod.installBrowserLog())
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
