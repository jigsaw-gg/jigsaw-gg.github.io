import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
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
  suggestPlayerName,
  writePlayerName,
} from '../playerName.ts'
import { fullscreenElement, isImmersive, setImmersive } from '../fullscreen.ts'
import { chooseGrid } from '../puzzle/cut.ts'
import { normalizeSessionId, playInvitePath } from '../puzzle/session.ts'
import { usePuzzleSession } from '../puzzle/usePuzzleSession.ts'
import { useWorldSync } from '../puzzle/useWorldSync.ts'
import { playTelegramInviteUrl } from '../telegram/config.ts'
import { useTelegramBackHandler } from '../telegram/useTelegramBackHandler.ts'
import { useTelegramMainButton } from '../telegram/useTelegramMainButton.ts'
import {
  hapticNotification,
  telegramSuggestedPlayerName,
} from '../telegram/webApp.ts'

export function PlayPage() {
  const { messages } = useI18n()
  const { sessionId: pathId } = useParams()
  const [search] = useSearchParams()
  const rawId = pathId ?? search.get('id') ?? ''
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
  const { locale } = useI18n()
  const [routedName] = useState(peekConfirmedPlayerName)
  const [nameDraft, setNameDraft] = useState(() => {
    const preset =
      routedName || readPlayerName() || telegramSuggestedPlayerName()
    if (preset) return { locale, name: preset, suggested: false }
    return { locale, name: suggestPlayerName(locale), suggested: true }
  })
  const [confirmedName, setConfirmedName] = useState<string | null>(routedName)
  if (
    nameDraft.suggested &&
    confirmedName === null &&
    nameDraft.locale !== locale
  ) {
    setNameDraft({
      locale,
      name: telegramSuggestedPlayerName() || suggestPlayerName(locale),
      suggested: true,
    })
  }
  const playerName = nameDraft.name
  function setPlayerName(name: string) {
    setNameDraft((current) => ({
      locale,
      name,
      suggested: current.suggested && name === current.name,
    }))
  }

  useEffect(() => {
    if (!routedName) return
    // Drop the one-time skip after this page mounts. A later open asks again.
    const timer = window.setTimeout(clearConfirmedPlayerName, 0)
    return () => window.clearTimeout(timer)
  }, [routedName])

  if (!confirmedName) {
    return (
      <PlayJoinForm
        playerName={playerName}
        setPlayerName={setPlayerName}
        onConfirm={(name) => {
          writePlayerName(name)
          setPlayerName(name)
          setConfirmedName(name)
        }}
      />
    )
  }

  return <PlaySession sessionId={sessionId} playerName={confirmedName} />
}

function PlayJoinForm({
  playerName,
  setPlayerName,
  onConfirm,
}: {
  playerName: string
  setPlayerName: (name: string) => void
  onConfirm: (name: string) => void
}) {
  const { messages } = useI18n()
  const name = normalizePlayerName(playerName)
  function submit() {
    if (!name) return
    onConfirm(name)
  }
  useTelegramMainButton({
    text: messages.play.join,
    visible: true,
    enabled: name !== null,
    onClick: submit,
  })
  return (
    <main className="page">
      <h1>{messages.play.joinTitle}</h1>
      <p className="lede">{messages.play.joinLede}</p>
      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
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
  const inviteUrl = `${window.location.origin}${playInvitePath(sessionId)}`
  const telegramInviteUrl = playTelegramInviteUrl(sessionId)
  const [copied, setCopied] = useState<'web' | 'telegram' | null>(null)
  const [playing, setPlaying] = useState(false)
  const [keepBoard, setKeepBoard] = useState(false)
  const playRef = useRef<HTMLButtonElement>(null)
  const grid = setup
    ? chooseGrid(setup.pieceCount, setup.imageWidth, setup.imageHeight)
    : null
  const others = players.filter((player) => !player.self)

  function enterPlay() {
    setKeepBoard(true)
    setPlaying(true)
  }

  function leavePlay() {
    setPlaying(false)
    window.requestAnimationFrame(() => playRef.current?.focus())
  }

  useTelegramBackHandler(leavePlay, playing)
  useTelegramMainButton({
    text: text.play,
    visible: !playing,
    enabled: Boolean(setup),
    onClick: enterPlay,
  })

  useEffect(() => {
    if (!playing) return
    const root = document.documentElement
    const previous = document.body.style.overflow
    const previousRootOverscroll = root.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    const previousRootTouch = root.style.touchAction
    const previousBodyTouch = document.body.style.touchAction
    document.body.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    document.body.style.overscrollBehavior = 'none'
    root.style.touchAction = 'none'
    document.body.style.touchAction = 'none'
    const header = document.querySelector('.topbar')
    if (header instanceof HTMLElement) header.inert = true
    const edgeTouches = new Set<number>()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (fullscreenElement()) return
      if (isImmersive()) {
        setImmersive(false)
        return
      }
      setPlaying(false)
      window.requestAnimationFrame(() => playRef.current?.focus())
    }
    const onTouchStart = (event: TouchEvent) => {
      claimHistoryEdge(event, edgeTouches)
    }
    const onTouchMove = (event: TouchEvent) => {
      holdHistoryEdge(event, edgeTouches)
    }
    const onTouchEnd = (event: TouchEvent) => {
      for (const touch of event.changedTouches) {
        edgeTouches.delete(touch.identifier)
      }
    }
    const edgeListener = { capture: true, passive: false } as const
    window.addEventListener('keydown', onKey)
    window.addEventListener('touchstart', onTouchStart, edgeListener)
    window.addEventListener('touchmove', onTouchMove, edgeListener)
    window.addEventListener('touchend', onTouchEnd, edgeListener)
    window.addEventListener('touchcancel', onTouchEnd, edgeListener)
    return () => {
      document.body.style.overflow = previous
      root.style.overscrollBehavior = previousRootOverscroll
      document.body.style.overscrollBehavior = previousBodyOverscroll
      root.style.touchAction = previousRootTouch
      document.body.style.touchAction = previousBodyTouch
      if (header instanceof HTMLElement) header.inert = false
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('touchstart', onTouchStart, edgeListener)
      window.removeEventListener('touchmove', onTouchMove, edgeListener)
      window.removeEventListener('touchend', onTouchEnd, edgeListener)
      window.removeEventListener('touchcancel', onTouchEnd, edgeListener)
    }
  }, [playing])

  async function copyInvite(kind: 'web' | 'telegram') {
    const value = kind === 'telegram' ? telegramInviteUrl : inviteUrl
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      hapticNotification('success')
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
      hapticNotification('error')
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
            onClick={() => void copyInvite('web')}
          >
            {copied === 'web' ? text.copied : text.copyInvite}
          </button>
          <label className="field">
            <span>{text.inviteTelegram}</span>
            <input
              readOnly
              value={telegramInviteUrl}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button
            type="button"
            className="button"
            onClick={() => void copyInvite('telegram')}
          >
            {copied === 'telegram' ? text.copied : text.copyInviteTelegram}
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

/** Safari and Chrome start a history swipe in this strip at the screen edge. */
const HISTORY_EDGE_PX = 32

/**
 * A touch that begins on the screen edge is the browser's back or forward
 * swipe. Claiming it here keeps the rest of that gesture for the board.
 */
function claimHistoryEdge(event: TouchEvent, edgeTouches: Set<number>): void {
  if (isPageControl(event.target)) return
  let claimed = false
  for (const touch of event.changedTouches) {
    const atEdge =
      touch.clientX < HISTORY_EDGE_PX ||
      touch.clientX > window.innerWidth - HISTORY_EDGE_PX
    if (!atEdge) continue
    edgeTouches.add(touch.identifier)
    claimed = true
  }
  if (claimed) event.preventDefault()
}

function holdHistoryEdge(event: TouchEvent, edgeTouches: Set<number>): void {
  for (const touch of event.touches) {
    if (!edgeTouches.has(touch.identifier)) continue
    event.preventDefault()
    return
  }
}

function isPageControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, label') !== null
  )
}
