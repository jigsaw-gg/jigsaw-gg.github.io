import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { ConnectionPill } from './components/ConnectionPill.tsx'
import { ThemeSwitcher } from './components/ThemeSwitcher.tsx'
import { AboutPage } from './pages/AboutPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { PlayPage } from './pages/PlayPage.tsx'
import { PuzzlesPage } from './pages/PuzzlesPage.tsx'
import { useApinatorStatus } from './useApinatorStatus.ts'
import './App.css'

export default function App() {
  const status = useApinatorStatus()

  return (
    <BrowserRouter>
      <div className="app">
        <header className="topbar">
          <NavLink to="/" className="topbar__brand" end>
            Jigsaw
          </NavLink>
          <div className="topbar__actions">
            <ConnectionPill state={status.state} />
            <ThemeSwitcher />
            <nav className="topbar__nav" aria-label="Primary">
              <NavLink to="/" end>
                Home
              </NavLink>
              <NavLink to="/puzzles">Puzzles</NavLink>
              <NavLink to="/about">About</NavLink>
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
