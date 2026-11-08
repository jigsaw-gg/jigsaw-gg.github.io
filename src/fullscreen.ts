const IMMERSIVE_CLASS = 'is-immersive'

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void | Promise<void>
}

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>
}

const listeners = new Set<() => void>()

function webkitDocument(): WebkitDocument {
  return document
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function fullscreenElement(): Element | null {
  return (
    document.fullscreenElement ??
    webkitDocument().webkitFullscreenElement ??
    null
  )
}

export function isImmersive(): boolean {
  return document.documentElement.classList.contains(IMMERSIVE_CLASS)
}

export function isExpanded(): boolean {
  return fullscreenElement() !== null || isImmersive()
}

export function subscribeExpanded(listener: () => void): () => void {
  listeners.add(listener)
  document.addEventListener('fullscreenchange', listener)
  document.addEventListener('webkitfullscreenchange', listener)
  return () => {
    listeners.delete(listener)
    document.removeEventListener('fullscreenchange', listener)
    document.removeEventListener('webkitfullscreenchange', listener)
  }
}

export function setImmersive(on: boolean): void {
  document.documentElement.classList.toggle(IMMERSIVE_CLASS, on)
  if (on) window.scrollTo(0, 0)
  emit()
}

async function exitNativeFullscreen(): Promise<void> {
  const doc = webkitDocument()
  if (document.fullscreenElement && document.exitFullscreen) {
    await document.exitFullscreen()
    return
  }
  await doc.webkitExitFullscreen?.()
}

async function enterNativeFullscreen(): Promise<boolean> {
  const root = document.documentElement as WebkitElement
  try {
    if (typeof root.requestFullscreen === 'function') {
      await root.requestFullscreen()
      return fullscreenElement() !== null
    }
    if (typeof root.webkitRequestFullscreen === 'function') {
      await root.webkitRequestFullscreen()
      return fullscreenElement() !== null
    }
  } catch {
    return false
  }
  return false
}

export async function toggleExpanded(): Promise<void> {
  if (fullscreenElement()) {
    try {
      await exitNativeFullscreen()
    } catch {
      // The browser can reject exit when fullscreen already ended.
    }
    setImmersive(false)
    return
  }
  if (isImmersive()) {
    setImmersive(false)
    return
  }
  const entered = await enterNativeFullscreen()
  if (!entered) setImmersive(true)
}
