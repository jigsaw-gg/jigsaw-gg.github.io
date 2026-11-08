import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { EmbeddedSafariWarning } from './components/EmbeddedSafariWarning.tsx'
import { SiteHeader } from './components/SiteHeader.tsx'
import { AboutPage } from './pages/AboutPage.tsx'
import { NetworkStatusPage } from './pages/NetworkStatusPage.tsx'
import { PlayPage } from './pages/PlayPage.tsx'
import { PuzzlesPage } from './pages/PuzzlesPage.tsx'
import { normalizeSessionId, playInvitePath } from './puzzle/session.ts'
import { TelegramUi } from './telegram/TelegramUi.tsx'
import { useApinatorStatus } from './useApinatorStatus.ts'
import './App.css'

function PlayInviteRoute() {
  const [search] = useSearchParams()
  if (!search.get('id')) return <Navigate to="/" replace />
  return <PlayPage />
}

function LegacyPlayRedirect() {
  const { sessionId } = useParams()
  const id = sessionId ? normalizeSessionId(sessionId) : null
  if (!id) return <PlayPage />
  return <Navigate to={playInvitePath(id)} replace />
}

export default function App() {
  const status = useApinatorStatus()

  return (
    <BrowserRouter>
      <TelegramUi>
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
              <Route path="/play" element={<PlayInviteRoute />} />
              <Route path="/play/:sessionId" element={<LegacyPlayRedirect />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          <EmbeddedSafariWarning />
        </div>
      </TelegramUi>
    </BrowserRouter>
  )
}
