import { nanoid } from 'nanoid'

export const MAX_PLAYER_NAME_LENGTH = 40

const NAME_KEY = 'jigsaw-player-name'
const ID_KEY = 'jigsaw-player-id'
const PLAYER_ID = /^[A-Za-z0-9_-]{21}$/

const PENDING_CONFIRM_KEY = 'jigsaw-player-name-pending'

/** Trimmed display name, or null when it should not be shown to other players. */
export function normalizePlayerName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > MAX_PLAYER_NAME_LENGTH) return null
  if (hasControlChar(name)) return null
  return name
}

function hasControlChar(name: string): boolean {
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

export function readPlayerName(): string {
  try {
    const raw = localStorage.getItem(NAME_KEY)
    if (!raw) return ''
    return normalizePlayerName(raw) ?? ''
  } catch {
    return ''
  }
}

const NICKNAME_ADJECTIVES = [
  'picky',
  'breezy',
  'sleepy',
  'wiggly',
  'sparkly',
  'mellow',
  'zippy',
  'clumsy',
  'cozy',
  'nifty',
  'jumpy',
  'sneaky',
  'rosy',
  'crispy',
  'bouncy',
  'dizzy',
  'fuzzy',
  'jaunty',
  'lucky',
  'merry',
  'peppy',
  'quirky',
  'sunny',
  'tidy',
  'wobbly',
  'zesty',
  'cheeky',
  'jolly',
  'gentle',
]

const NICKNAME_NOUNS = [
  'cucumber',
  'panda',
  'kettle',
  'muffin',
  'pebble',
  'turnip',
  'waffle',
  'badger',
  'comet',
  'donut',
  'fern',
  'goose',
  'hedgehog',
  'igloo',
  'jelly',
  'kiwi',
  'lantern',
  'noodle',
  'otter',
  'pickle',
  'quokka',
  'radish',
  'sprout',
  'teacup',
  'walnut',
  'yacht',
  'zebra',
  'biscuit',
  'cactus',
]

/** A fresh adjective-noun name for someone who has not chosen one yet. */
export function suggestPlayerName(): string {
  const adjective =
    NICKNAME_ADJECTIVES[Math.floor(Math.random() * NICKNAME_ADJECTIVES.length)]
  const noun = NICKNAME_NOUNS[Math.floor(Math.random() * NICKNAME_NOUNS.length)]
  return `${adjective}-${noun}`
}

export function writePlayerName(name: string): void {
  const normalized = normalizePlayerName(name)
  if (!normalized) return
  try {
    localStorage.setItem(NAME_KEY, normalized)
  } catch {
    // ignore quota / privacy mode errors
  }
}

/** Stable id for this browser so a renamed player stays one person in the session. */
export function readPlayerId(): string {
  try {
    const raw = localStorage.getItem(ID_KEY)
    if (raw && PLAYER_ID.test(raw)) return raw
  } catch {
    // Fall through and issue a new id for this page load.
  }
  const id = nanoid(21)
  try {
    localStorage.setItem(ID_KEY, id)
  } catch {
    // The id still distinguishes this tab until it is closed.
  }
  return id
}

/** Skip the invite prompt once, for the session this browser just created. */
export function rememberConfirmedPlayerName(name: string): void {
  const normalized = normalizePlayerName(name)
  if (!normalized) return
  try {
    sessionStorage.setItem(PENDING_CONFIRM_KEY, normalized)
  } catch {
    // The play page will ask again.
  }
}

export function peekConfirmedPlayerName(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CONFIRM_KEY)
    if (!raw) return null
    return normalizePlayerName(raw)
  } catch {
    return null
  }
}

export function clearConfirmedPlayerName(): void {
  try {
    sessionStorage.removeItem(PENDING_CONFIRM_KEY)
  } catch {
    // ignore privacy mode errors
  }
}
