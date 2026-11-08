import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { ConnectionState } from '@apinator/client'
import { ConnectionPill } from './ConnectionPill.tsx'
import { FullscreenButton } from './FullscreenButton.tsx'
import { LanguageSwitcher } from './LanguageSwitcher.tsx'
import { ThemeSwitcher } from './ThemeSwitcher.tsx'
import { useI18n } from '../i18n/useI18n.ts'

const COMPACT_NAV = '(max-width: 1100px)'

export function SiteHeader({ state }: { state: ConnectionState }) {
  const { messages } = useI18n()
  const { pathname } = useLocation()
  const [compact, setCompact] = useState(
    () => window.matchMedia(COMPACT_NAV).matches,
  )
  const [open, setOpen] = useState(false)
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setOpen(false)
  }
  const menuRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const pullStop = useRef<(() => void) | null>(null)
  const swallowClick = useRef(false)

  useEffect(() => {
    const media = window.matchMedia(COMPACT_NAV)
    const onChange = () => {
      setCompact(media.matches)
      if (!media.matches) setOpen(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const main = document.querySelector('.app__main')
    if (!(main instanceof HTMLElement)) return
    const lock = open && compact
    main.inert = lock
    if (!lock) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      main.inert = false
      document.body.style.overflow = previous
    }
  }, [open, compact])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('dialog[open]')) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      menuRef.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  function closeMenu() {
    setOpen(false)
    const drawer = drawerRef.current
    if (drawer?.contains(document.activeElement)) menuRef.current?.focus()
  }

  function toggleMenu() {
    setOpen((current) => {
      const next = !current
      if (next) {
        window.requestAnimationFrame(() => {
          drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus()
        })
      }
      return next
    })
  }

  useEffect(() => () => pullStop.current?.(), [])

  function onBarPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!compact || event.button !== 0) return
    if (!(event.target instanceof Element)) return
    if (event.target.closest('button, input, textarea, select')) return
    pullStop.current?.()
    const startY = event.clientY
    const pointerId = event.pointerId
    let moved = false
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      if (pullStop.current === stop) pullStop.current = null
    }
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId || moved) return
      const dy = move.clientY - startY
      if (dy <= 28 && dy >= -28) return
      moved = true
      setOpen(dy > 0)
    }
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId !== pointerId) return
      if (moved) swallowClick.current = true
      stop()
    }
    pullStop.current = stop
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  function onBarClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!swallowClick.current) return
    swallowClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  const menuLabel = open ? messages.nav.close : messages.nav.menu

  return (
    <>
      <header className={open ? 'topbar topbar--open' : 'topbar'}>
        <div
          className="topbar__bar"
          onPointerDown={onBarPointerDown}
          onClickCapture={onBarClickCapture}
        >
          <NavLink to="/" className="topbar__brand" end>
            Jigsaw
          </NavLink>
          <div className="topbar__tools">
            {compact ? (
              <ConnectionPill state={state} compact quiet={open} />
            ) : (
              <ConnectionPill state={state} />
            )}
            <FullscreenButton />
            <button
              ref={menuRef}
              type="button"
              className="topbar__menu"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={toggleMenu}
            >
              {menuLabel}
              <Chevron open={open} />
            </button>
          </div>
        </div>
        <div
          ref={drawerRef}
          id="site-menu"
          className="topbar__drawer"
          inert={compact && !open ? true : undefined}
        >
          <nav
            className="topbar__nav"
            aria-label={messages.nav.primary}
            onClick={() => setOpen(false)}
          >
            <NavLink to="/" end>
              {messages.nav.newPuzzle}
            </NavLink>
            <NavLink to="/network">{messages.nav.network}</NavLink>
            <NavLink to="/about">{messages.nav.about}</NavLink>
          </nav>
          <LanguageSwitcher labeled={compact} />
          <ThemeSwitcher />
          {compact && <ConnectionPill state={state} />}
        </div>
      </header>
      {open && compact && (
        <button
          type="button"
          className="topbar__scrim"
          aria-label={messages.nav.close}
          onClick={closeMenu}
        />
      )}
    </>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={
        open ? 'topbar__chevron topbar__chevron--open' : 'topbar__chevron'
      }
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        d="M3 6l5 5 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
