import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { ConnectionPill } from './components/ConnectionPill.tsx'
import { LanguageSwitcher } from './components/LanguageSwitcher.tsx'
import { ThemeSwitcher } from './components/ThemeSwitcher.tsx'
import { useI18n } from './i18n/useI18n.ts'
import { AboutPage } from './pages/AboutPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { PlayPage } from './pages/PlayPage.tsx'
import { PuzzlesPage } from './pages/PuzzlesPage.tsx'
import { useApinatorStatus } from './useApinatorStatus.ts'
import './App.css'

export default function App() {
  const status = useApinatorStatus()
  const { messages } = useI18n()

  return (
    <BrowserRouter>
      <div className="app">
        <header className="topbar">
          <NavLink to="/" className="topbar__brand" end>
            Jigsaw
          </NavLink>
          <div className="topbar__actions">
            <ConnectionPill state={status.state} />
            <LanguageSwitcher />
            <ThemeSwitcher />
            <nav className="topbar__nav" aria-label={messages.nav.primary}>
              <NavLink to="/" end>
                {messages.nav.home}
              </NavLink>
              <NavLink to="/puzzles">{messages.nav.puzzles}</NavLink>
              <NavLink to="/about">{messages.nav.about}</NavLink>
            </nav>
          </div>
        </header>
        <Routes>
          <Route path="/" element={<HomePage status={status} />} />
          <Route path="/puzzles" element={<PuzzlesPage />} />
          <Route path="/play/:sessionId" element={<PlayPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
