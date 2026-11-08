import { apinator, type RealtimeChannel } from '../apinator.ts'
import { puzzleChannelName } from './session.ts'

const retains = new Map<string, number>()

/** Share one private-channel subscription across session presence and play sync. */
export function retainPuzzleChannel(sessionId: string): RealtimeChannel | null {
  const client = apinator
  if (!client) return null
  const name = puzzleChannelName(sessionId)
  retains.set(name, (retains.get(name) ?? 0) + 1)
  return client.subscribe(name)
}

export function releasePuzzleChannel(sessionId: string): void {
  const client = apinator
  if (!client) return
  const name = puzzleChannelName(sessionId)
  const next = (retains.get(name) ?? 0) - 1
  if (next > 0) {
    retains.set(name, next)
    return
  }
  retains.delete(name)
  client.unsubscribe(name)
}
