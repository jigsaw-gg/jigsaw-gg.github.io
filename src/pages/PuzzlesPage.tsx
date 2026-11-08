import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlayerNameField } from '../components/PlayerNameField.tsx'
import { useI18n } from '../i18n/useI18n.ts'
import {
  normalizePlayerName,
  readPlayerName,
  rememberConfirmedPlayerName,
  writePlayerName,
} from '../playerName.ts'
import { chooseGrid } from '../puzzle/cut.ts'
import {
  createSessionId,
  DEFAULT_IMAGE_URL,
  DEFAULT_PIECE_COUNT,
  GALLERY_IMAGE_URLS,
  playInvitePath,
  writeSession,
  type PuzzleSetup,
} from '../puzzle/session.ts'
import { telegramSuggestedPlayerName } from '../telegram/webApp.ts'
import { useTelegramMainButton } from '../telegram/useTelegramMainButton.ts'

export function PuzzlesPage() {
  const navigate = useNavigate()
  const { messages } = useI18n()
  const text = messages.puzzles
  const [playerName, setPlayerName] = useState(
    () => readPlayerName() || telegramSuggestedPlayerName(),
  )
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGE_URL)
  const [pieceCount, setPieceCount] = useState(String(DEFAULT_PIECE_COUNT))
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0])
  const [imageSize, setImageSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const galleryButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    const src = imageUrl.trim()
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
      setImageFailed(false)
      setLoadedPreviewUrl(src)
    }
    img.onerror = () => {
      if (cancelled) return
      setImageSize(null)
      setImageFailed(true)
      setLoadedPreviewUrl(null)
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  const count = Number(pieceCount)
  const countOk = Number.isInteger(count) && count >= 1 && count <= 200
  const name = normalizePlayerName(playerName)
  const canStart = imageSize !== null && countOk && name !== null
  const showPreview =
    loadedPreviewUrl === imageUrl.trim() && loadedPreviewUrl !== ''
  const grid =
    imageSize && countOk
      ? chooseGrid(count, imageSize.width, imageSize.height)
      : null
  const actualPieces = grid ? grid.cols * grid.rows : null

  function start() {
    if (!imageSize || !countOk || !name) return
    writePlayerName(name)
    rememberConfirmedPlayerName(name)
    const sessionId = createSessionId()
    const setup: PuzzleSetup = {
      imageUrl: imageUrl.trim(),
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      pieceCount: count,
      seed,
    }
    writeSession(sessionId, setup)
    navigate(playInvitePath(sessionId))
  }

  useTelegramMainButton({
    text: text.start,
    visible: true,
    enabled: canStart,
    onClick: start,
  })

  function pickGalleryImage(url: string) {
    setImageUrl(url)
    setGalleryOpen(false)
    galleryButtonRef.current?.focus()
  }

  return (
    <main className="page page--puzzles">
      <div className="setup-layout">
        <div className="setup-layout__form">
          <h1>{text.title}</h1>
          <p className="lede">{text.lede}</p>
          <form
            className="setup"
            onSubmit={(event) => {
              event.preventDefault()
              start()
            }}
          >
            <PlayerNameField
              value={playerName}
              onChange={setPlayerName}
              autoFocus
            />
            <label className="field">
              <span>{text.imageUrl}</span>
              <input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="gallery-pick">
              <button
                ref={galleryButtonRef}
                type="button"
                className="button"
                aria-expanded={galleryOpen}
                aria-controls={galleryOpen ? 'puzzle-gallery' : undefined}
                onClick={() => setGalleryOpen((open) => !open)}
              >
                {text.gallery}
              </button>
              {galleryOpen && (
                <ul className="gallery" id="puzzle-gallery">
                  {GALLERY_IMAGE_URLS.map((url, index) => {
                    const selected = imageUrl.trim() === url
                    return (
                      <li key={url}>
                        <button
                          type="button"
                          className={
                            selected
                              ? 'gallery__choice gallery__choice--selected'
                              : 'gallery__choice'
                          }
                          aria-pressed={selected}
                          onClick={() => pickGalleryImage(url)}
                        >
                          <img src={url} alt={text.galleryImage(index + 1)} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <label className="field">
              <span>{text.pieces}</span>
              <input
                value={pieceCount}
                onChange={(event) => setPieceCount(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <dl className="facts setup__facts">
              <div>
                <dt>{text.imageSize}</dt>
                <dd>
                  {imageSize
                    ? `${imageSize.width} × ${imageSize.height}`
                    : imageFailed
                      ? text.unavailable
                      : text.loading}
                </dd>
              </div>
              <div>
                <dt>{text.arrangement}</dt>
                <dd>
                  {grid && actualPieces !== null
                    ? `${grid.cols} × ${grid.rows} · ${text.pieceCount(actualPieces)}`
                    : countOk
                      ? imageFailed
                        ? text.unavailable
                        : text.loading
                      : '—'}
                </dd>
              </div>
              <div>
                <dt>{text.seed}</dt>
                <dd>{seed}</dd>
              </div>
            </dl>
            {imageFailed && (
              <p className="banner banner--error" role="alert">
                {text.imageError}
              </p>
            )}
            <button type="submit" className="button" disabled={!canStart}>
              {text.start}
            </button>
          </form>
        </div>
        <div className="setup-preview">
          <div className="setup-preview__frame">
            {showPreview && (
              <img
                className="setup-preview__image"
                src={loadedPreviewUrl}
                alt={text.imagePreview}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
