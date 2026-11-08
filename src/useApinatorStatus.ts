import { useSyncExternalStore } from 'react'
import {
  getApinatorStatus,
  subscribeApinatorStatus,
  type ApinatorSnapshot,
} from './apinator.ts'

export function useApinatorStatus(): ApinatorSnapshot {
  return useSyncExternalStore(subscribeApinatorStatus, getApinatorStatus)
}
