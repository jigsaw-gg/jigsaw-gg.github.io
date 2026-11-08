import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { EmbeddedSafariWarning } from './components/EmbeddedSafariWarning.tsx'
import { SiteHeader } from './components/SiteHeader.tsx'
import { AboutPage } from './pages/AboutPage.tsx'
import { NetworkStatusPage } from './pages/NetworkStatusPage.tsx'
import { PlayPage } from './pages/PlayPage.tsx'
import { PuzzlesPage } from './pages/PuzzlesPage.tsx'
import { useApinatorStatus } from './useApinatorStatus.ts'
import './App.css'

export default function App() {
  const status = useApinatorStatus()

  return (
    <BrowserRouter>
      <div className="app">
        <SiteHeader state={status.state} />
        <div className="app__main">
          <Routes>
            <Route path="/" element={<PuzzlesPage />} />
            <Route
              path="/network"
              element={<NetworkStatusPage status={status} />}
            />
            <Route path="/puzzles" element={<Navigate to="/" replace />} />
            <Route path="/play/:sessionId" element={<PlayPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <EmbeddedSafariWarning />
      </div>
    </BrowserRouter>
  )
}
