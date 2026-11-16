const WEBTRANSPORT_KEY = 'jigsaw-webtransport-enabled'

const listeners = new Set<() => void>()

function readRaw(): string | null {
  try {
    return localStorage.getItem(WEBTRANSPORT_KEY)
  } catch {
    return null
  }
}

/** Prefer WebTransport when true (default). Persisted in localStorage. */
export function isWebTransportEnabled(): boolean {
  const raw = readRaw()
  if (raw === null) return true
  return raw !== '0' && raw !== 'false'
}

export function setWebTransportEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(WEBTRANSPORT_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore quota / privacy mode */
  }
  for (const listener of listeners) listener()
}

export function subscribeWebTransportEnabled(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
