import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PlayerNameField } from '../components/PlayerNameField.tsx'
import { PuzzleBoard } from '../components/PuzzleBoard.tsx'
import { localizeError } from '../i18n/errors.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { Messages } from '../i18n/types.ts'
import {
  clearConfirmedPlayerName,
  normalizePlayerName,
  peekConfirmedPlayerName,
  readPlayerId,
  readPlayerName,
  writePlayerName,
} from '../playerName.ts'
import { chooseGrid } from '../puzzle/cut.ts'
import { normalizeSessionId } from '../puzzle/session.ts'
import { usePuzzleSession } from '../puzzle/usePuzzleSession.ts'
import { useWorldSync } from '../puzzle/useWorldSync.ts'

export function PlayPage() {
  const { messages } = useI18n()
  const { sessionId: rawId } = useParams()
  const sessionId = rawId ? normalizeSessionId(rawId) : null
  if (!sessionId) {
    return (
      <main className="page">
        <h1>{messages.play.unknownTitle}</h1>
        <p className="lede">{messages.play.unknownLede}</p>
      </main>
    )
  }
  return <PlayEntry sessionId={sessionId} />
}

function PlayEntry({ sessionId }: { sessionId: string }) {
  const { messages } = useI18n()
  const [routedName] = useState(peekConfirmedPlayerName)
  const [playerName, setPlayerName] = useState(
    () => routedName ?? readPlayerName(),
  )
  const [confirmedName, setConfirmedName] = useState<string | null>(routedName)

  useEffect(() => {
    if (!routedName) return
    // Drop the one-time skip after this page mounts. A later open asks again.
    const timer = window.setTimeout(clearConfirmedPlayerName, 0)
    return () => window.clearTimeout(timer)
  }, [routedName])

  if (!confirmedName) {
    const name = normalizePlayerName(playerName)
    return (
      <main className="page">
        <h1>{messages.play.joinTitle}</h1>
        <p className="lede">{messages.play.joinLede}</p>
        <form
          className="setup"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name) return
            writePlayerName(name)
            setPlayerName(name)
            setConfirmedName(name)
          }}
        >
          <PlayerNameField
            value={playerName}
            onChange={setPlayerName}
            autoFocus
          />
          <button type="submit" className="button" disabled={name === null}>
            {messages.play.join}
          </button>
        </form>
      </main>
    )
  }

  return <PlaySession sessionId={sessionId} playerName={confirmedName} />
}

function playerLabel(
  player: { id: string; name: string; self: boolean },
  masterId: string | null,
  text: Messages['player'],
): string {
  const tags: string[] = []
  if (player.self) tags.push(text.you)
  if (player.id === masterId) tags.push(text.host)
  if (tags.length === 0) return player.name
  return `${player.name} (${tags.join(', ')})`
}

function PlaySession({
  sessionId,
  playerName,
}: {
  sessionId: string
  playerName: string
}) {
  const { messages } = useI18n()
  const text = messages.play
  const [playerId] = useState(readPlayerId)
  const { setup, phase, channelError, channelName, source, players } =
    usePuzzleSession(sessionId, { id: playerId, name: playerName })
  const world = useWorldSync(
    sessionId,
    { id: playerId, name: playerName },
    setup,
    players,
  )
  const inviteUrl = `${window.location.origin}/play/${sessionId}`
  const [copied, setCopied] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [keepBoard, setKeepBoard] = useState(false)
  const playRef = useRef<HTMLButtonElement>(null)
  const grid = setup
    ? chooseGrid(setup.pieceCount, setup.imageWidth, setup.imageHeight)
    : null
  const others = players.filter((player) => !player.self)

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
        <h1>{text.sessionTitle}</h1>
        <p className="lede">
          {source === 'peer'
            ? text.sourcePeer
            : source === 'local'
              ? text.sourceLocal
              : text.sourceWaiting}
        </p>
        <section className="players-block" aria-label={text.players}>
          <h2>{text.players}</h2>
          <ul className="players">
            {players.map((player) => (
              <li key={player.id}>
                {playerLabel(player, world.masterId, messages.player)}
              </li>
            ))}
          </ul>
          <p className="muted">{text.persistence}</p>
          {others.length === 0 && <p className="muted">{text.waitingOthers}</p>}
        </section>
        <section className="invite">
          <label className="field">
            <span>{text.invite}</span>
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
            {copied ? text.copied : text.copyInvite}
          </button>
          <button
            ref={playRef}
            type="button"
            className="button button--primary"
            disabled={!setup}
            onClick={enterPlay}
          >
            {text.play}
          </button>
        </section>
        <dl className="facts">
          <div>
            <dt>{text.channel}</dt>
            <dd>
              <code>{channelName}</code>
            </dd>
          </div>
          <div>
            <dt>{text.channelStatus}</dt>
            <dd>
              {phase === 'live'
                ? text.joined
                : phase === 'error'
                  ? text.failed
                  : text.joining}
            </dd>
          </div>
          {setup && (
            <>
              <div>
                <dt>{text.image}</dt>
                <dd>
                  {setup.imageWidth} × {setup.imageHeight}
                </dd>
              </div>
              <div>
                <dt>{text.pieces}</dt>
                <dd>
                  {grid ? grid.cols * grid.rows : setup.pieceCount}
                  {grid ? ` · ${grid.cols} × ${grid.rows}` : ''}
                </dd>
              </div>
              <div>
                <dt>{text.seed}</dt>
                <dd>{setup.seed}</dd>
              </div>
            </>
          )}
        </dl>
        {channelError && (
          <p className="banner banner--error" role="alert">
            {localizeError(channelError, messages.errors)}
          </p>
        )}
        {!setup && phase !== 'error' && (
          <p className="muted" role="status">
            {text.asking}
          </p>
        )}
      </main>
      {keepBoard && setup && world.placements && (
        <PuzzleBoard
          setup={setup}
          active={playing}
          placements={world.placements}
          cursors={world.cursors}
          raisedGroups={world.raisedGroups}
          yieldNonce={world.yieldNonce}
          onLeave={leavePlay}
          onPointer={world.reportPointer}
          onPointerGone={world.reportPointerGone}
          onDrag={world.reportDrag}
          onDragEnd={world.reportDragEnd}
          onDragCancel={world.reportDragCancel}
        />
      )}
    </>
  )
}
