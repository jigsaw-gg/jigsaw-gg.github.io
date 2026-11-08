import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlayerNameField } from '../components/PlayerNameField.tsx'
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
  writeSession,
  type PuzzleSetup,
} from '../puzzle/session.ts'

export function PuzzlesPage() {
  const navigate = useNavigate()
  const [playerName, setPlayerName] = useState(readPlayerName)
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGE_URL)
  const [pieceCount, setPieceCount] = useState(String(DEFAULT_PIECE_COUNT))
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0])
  const [imageSize, setImageSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const galleryButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
      setImageError(null)
    }
    img.onerror = () => {
      if (cancelled) return
      setImageSize(null)
      setImageError('Could not load that image.')
    }
    img.src = imageUrl.trim()
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  const count = Number(pieceCount)
  const countOk = Number.isInteger(count) && count >= 1 && count <= 200
  const name = normalizePlayerName(playerName)
  const canStart = imageSize !== null && countOk && name !== null
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
    navigate(`/play/${sessionId}`)
  }

  function pickGalleryImage(url: string) {
    setImageUrl(url)
    setGalleryOpen(false)
    galleryButtonRef.current?.focus()
  }

  return (
    <main className="page">
      <h1>New puzzle</h1>
      <p className="lede">
        Pick an image and how many pieces to cut. Choose the name other players
        will see. The seed is chosen here. Start opens a private session and an
        invite link.
      </p>
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
          <span>Image URL</span>
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
            Pick from gallery
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
                      <img src={url} alt={`Gallery image ${index + 1}`} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <label className="field">
          <span>Pieces</span>
          <input
            value={pieceCount}
            onChange={(event) => setPieceCount(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <dl className="facts setup__facts">
          <div>
            <dt>Image size</dt>
            <dd>
              {imageSize
                ? `${imageSize.width} × ${imageSize.height}`
                : imageError
                  ? 'Unavailable'
                  : 'Loading…'}
            </dd>
          </div>
          <div>
            <dt>Arrangement</dt>
            <dd>
              {grid && actualPieces !== null
                ? `${grid.cols} × ${grid.rows} · ${actualPieces} ${
                    actualPieces === 1 ? 'piece' : 'pieces'
                  }`
                : countOk
                  ? imageError
                    ? 'Unavailable'
                    : 'Loading…'
                  : '—'}
            </dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>{seed}</dd>
          </div>
        </dl>
        {imageError && (
          <p className="banner banner--error" role="alert">
            {imageError}
          </p>
        )}
        <button type="submit" className="button" disabled={!canStart}>
          Start
        </button>
      </form>
    </main>
  )
}
