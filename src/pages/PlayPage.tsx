import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PuzzleBoard } from '../components/PuzzleBoard.tsx'
import { chooseGrid } from '../puzzle/cut.ts'
import { normalizeSessionId } from '../puzzle/session.ts'
import { usePuzzleSession } from '../puzzle/usePuzzleSession.ts'

export function PlayPage() {
  const { sessionId: rawId } = useParams()
  const sessionId = rawId ? normalizeSessionId(rawId) : null
  if (!sessionId) {
    return (
      <main className="page">
        <h1>Unknown session</h1>
        <p className="lede">
          This invite link does not point at a puzzle session.
        </p>
      </main>
    )
  }
  return <PlaySession sessionId={sessionId} />
}

function PlaySession({ sessionId }: { sessionId: string }) {
  const { setup, phase, channelError, channelName, source } =
    usePuzzleSession(sessionId)
  const inviteUrl = `${window.location.origin}/play/${sessionId}`
  const [copied, setCopied] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [keepBoard, setKeepBoard] = useState(false)
  const playRef = useRef<HTMLButtonElement>(null)
  const grid = setup
    ? chooseGrid(setup.pieceCount, setup.imageWidth, setup.imageHeight)
    : null

  useEffect(() => {
    if (!playing) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPlaying(false)
      window.requestAnimationFrame(() => playRef.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [playing])

  function enterPlay() {
    setKeepBoard(true)
    setPlaying(true)
  }

  function leavePlay() {
    setPlaying(false)
    window.requestAnimationFrame(() => playRef.current?.focus())
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <main className="page page--wide" hidden={playing}>
        <h1>Puzzle session</h1>
        <p className="lede">
          {source === 'peer'
            ? 'Setup arrived from a connected player and is saved in this browser.'
            : source === 'local'
              ? 'Setup is saved in this browser. Connected players can request it.'
              : 'Waiting for a connected player who already has this session.'}
        </p>
        <section className="invite">
          <label className="field">
            <span>Invite link</span>
            <input
              readOnly
              value={inviteUrl}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button
            type="button"
            className="button"
            onClick={() => void copyInvite()}
          >
            {copied ? 'Copied' : 'Copy invite'}
          </button>
          <button
            ref={playRef}
            type="button"
            className="button button--primary"
            disabled={!setup}
            onClick={enterPlay}
          >
            Play
          </button>
        </section>
        <dl className="facts">
          <div>
            <dt>Channel</dt>
            <dd>
              <code>{channelName}</code>
            </dd>
          </div>
          <div>
            <dt>Channel status</dt>
            <dd>
              {phase === 'live'
                ? 'Joined'
                : phase === 'error'
                  ? 'Failed'
                  : 'Joining…'}
            </dd>
          </div>
          {setup && (
            <>
              <div>
                <dt>Image</dt>
                <dd>
                  {setup.imageWidth} × {setup.imageHeight}
                </dd>
              </div>
              <div>
                <dt>Pieces</dt>
                <dd>
                  {setup.pieceCount}
                  {grid ? ` · ${grid.cols} × ${grid.rows}` : ''}
                </dd>
              </div>
              <div>
                <dt>Seed</dt>
                <dd>{setup.seed}</dd>
              </div>
            </>
          )}
        </dl>
        {channelError && (
          <p className="banner banner--error" role="alert">
            {channelError}
          </p>
        )}
        {!setup && phase !== 'error' && (
          <p className="muted" role="status">
            Asking connected players for the image, size, piece count, and seed.
          </p>
        )}
      </main>
      {keepBoard && setup && (
        <PuzzleBoard setup={setup} active={playing} onLeave={leavePlay} />
      )}
    </>
  )
}
