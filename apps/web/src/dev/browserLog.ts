const BUTTONS = [
  'cross',
  'circle',
  'square',
  'triangle',
  'L1',
  'R1',
  'L2',
  'R2',
  'share',
  'options',
  'L3',
  'R3',
  'up',
  'down',
  'left',
  'right',
  'ps',
  'pad',
]

const INSTALLED = '__jigsawBrowserLog'

/** Forward console output and gamepad snapshots to the dev server log. */
export function installBrowserLog(): void {
  const host = globalThis as typeof globalThis & { [INSTALLED]?: boolean }
  if (host[INSTALLED]) return
  host[INSTALLED] = true
  hookConsole()
  console.log(
    `gamepad diag ready origin=${location.origin} secure=${window.isSecureContext} getGamepads=${typeof navigator.getGamepads} ua=${navigator.userAgent}`,
  )
  if (!window.isSecureContext) {
    console.warn(
      'gamepad blocked: this origin is not a secure context. Use https:// (LAN) or http://127.0.0.1/ (localhost). Slither works because it is HTTPS.',
    )
  }
  window.addEventListener('gamepadconnected', onGamepadEvent)
  window.addEventListener('gamepaddisconnected', onGamepadEvent)
  window.setInterval(pollGamepads, 250)
  pollGamepads()
}

function hookConsole(): void {
  const levels = ['debug', 'log', 'info', 'warn', 'error'] as const
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      post(level, format(args))
    }
  }
  window.addEventListener('error', (event) => {
    post('error', event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    post('error', `unhandledrejection ${stringify(event.reason)}`)
  })
}

function post(level: string, message: string): void {
  if (!message) return
  void fetch('/__browser-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level, message }),
    keepalive: true,
  }).catch(() => {})
}

function format(args: unknown[]): string {
  if (args.length === 0) return ''
  const [first, ...rest] = args
  if (typeof first !== 'string' || !/%[sdifoO]/.test(first)) {
    return args.map(stringify).join(' ')
  }
  let index = 0
  const text = first.replace(/%[sdifoO]/g, (token) => {
    const value = rest[index]
    index += 1
    if (token === '%o' || token === '%O') return stringify(value)
    return String(value)
  })
  return [text, ...rest.slice(index).map(stringify)].filter(Boolean).join(' ')
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function onGamepadEvent(event: GamepadEvent): void {
  const pad = event.gamepad
  console.log(
    `gamepad ${event.type} index=${pad.index} id=${JSON.stringify(pad.id)} mapping=${JSON.stringify(pad.mapping)} buttons=${pad.buttons.length} axes=${pad.axes.length}`,
  )
}

let lastSummary = ''
let lastInput = ''
let lastBeat = 0
let lastInputAt = 0

function pollGamepads(): void {
  const summary = describePads()
  const now = Date.now()
  if (summary !== lastSummary || now - lastBeat >= 2000) {
    console.log(`gamepad poll: ${summary}`)
    lastSummary = summary
    lastBeat = now
  }
  const input = describeInput()
  if (!input) {
    lastInput = ''
    return
  }
  const buttonsChanged = input.buttons !== lastInput
  if (buttonsChanged || now - lastInputAt >= 400) {
    console.log(`gamepad input: ${input.line}`)
    lastInput = input.buttons
    lastInputAt = now
  }
}

function describePads(): string {
  if (!window.isSecureContext) {
    return `blocked insecure origin=${location.origin}`
  }
  const list = navigator.getGamepads?.()
  if (!list) return 'getGamepads missing'
  const slots = Array.from(list, (pad, index) =>
    pad
      ? `#${index} id=${JSON.stringify(pad.id)} mapping=${JSON.stringify(pad.mapping)} connected=${pad.connected} buttons=${pad.buttons.length} axes=${pad.axes.length}`
      : `#${index}=null`,
  )
  const live = slots.filter((slot) => !slot.endsWith('=null'))
  return live.length > 0
    ? live.join(' || ')
    : `none slots=${list.length} [${slots.join(',')}]`
}

function describeInput(): { buttons: string; line: string } | null {
  const list = navigator.getGamepads?.()
  if (!list) return null
  const parts: string[] = []
  const buttonKeys: string[] = []
  for (let index = 0; index < list.length; index += 1) {
    const pad = list[index]
    if (!pad) continue
    const pressed = pad.buttons
      .map((button, buttonIndex) => {
        if (!button.pressed && button.value <= 0.12) return ''
        const name = BUTTONS[buttonIndex] ?? String(buttonIndex)
        return `${name}=${button.value.toFixed(2)}`
      })
      .filter(Boolean)
    const axes = Array.from(pad.axes, (value) => value.toFixed(2)).join(',')
    const moved = Array.from(pad.axes).some((value) => Math.abs(value) > 0.15)
    if (pressed.length === 0 && !moved) continue
    buttonKeys.push(`${index}:${pressed.join(',')}`)
    parts.push(`#${index} [${pressed.join(' ')}] axes=${axes}`)
  }
  if (parts.length === 0) return null
  return { buttons: buttonKeys.join('|'), line: parts.join(' || ') }
}
