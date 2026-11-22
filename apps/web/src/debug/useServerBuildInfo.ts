import { useEffect, useState } from 'react'
import { GAME_HTTP_BASE } from '../core/config.ts'

export type ServerBuildInfo = {
  commit: string
  log: string
}

type BuildState =
  | { status: 'loading' }
  | { status: 'ready'; info: ServerBuildInfo }
  | { status: 'unavailable' }

function normalizeBuildInfo(raw: unknown): ServerBuildInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const commit = typeof row.commit === 'string' ? row.commit.trim() : ''
  const log = typeof row.log === 'string' ? row.log.trim() : ''
  if (!commit && !log) return null
  return { commit, log }
}

export function useServerBuildInfo(): BuildState {
  const [state, setState] = useState<BuildState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const base = GAME_HTTP_BASE.replace(/\/$/, '')

    void (async () => {
      try {
        const res = await fetch(`${base}/v1/build`)
        if (!res.ok) {
          if (!cancelled) setState({ status: 'unavailable' })
          return
        }
        const info = normalizeBuildInfo(await res.json())
        if (!cancelled) {
          setState(info ? { status: 'ready', info } : { status: 'unavailable' })
        }
      } catch {
        if (!cancelled) setState({ status: 'unavailable' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
