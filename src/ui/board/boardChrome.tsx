import type { HandoverMarks, ThumbSide } from './twoThumb.ts'

export interface ThumbStickView {
  side: ThumbSide
  cx: number
  cy: number
  radius: number
  knobX: number
  knobY: number
}

export function ThumbStick({ stick }: { stick: ThumbStickView }) {
  const halfStyle: React.CSSProperties =
    stick.side === 'left'
      ? { left: 10, width: 'calc(50% - 20px)' }
      : { left: 'calc(50% + 10px)', width: 'calc(50% - 20px)' }
  return (
    <div className="thumb-stick" aria-hidden="true">
      <div className="thumb-stick__half" style={halfStyle} />
      <svg className="thumb-stick__arm">
        <line x1={stick.cx} y1={stick.cy} x2={stick.knobX} y2={stick.knobY} />
      </svg>
      <div
        className="thumb-stick__range"
        style={{
          left: stick.cx,
          top: stick.cy,
          width: stick.radius * 2,
          height: stick.radius * 2,
        }}
      />
      <div
        className="thumb-stick__knob"
        style={{ left: stick.knobX, top: stick.knobY }}
      />
    </div>
  )
}

export function GamepadIcon() {
  return (
    <svg className="gamepad-blink__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 7.2h9.6c2.2 0 4.2 1.9 4.2 4.4 0 2.7-1.4 4.9-3.3 4.9-1.1 0-1.8-.6-2.5-1.5l-.6-.8H9.4l-.6.8c-.7.9-1.4 1.5-2.5 1.5-1.9 0-3.3-2.2-3.3-4.9 0-2.5 2-4.4 4.2-4.4z"
      />
      <path
        fill="var(--surface)"
        d="M8.1 10.2h1.3v1.1h1.1v1.3H9.4v1.1H8.1v-1.1H7v-1.3h1.1zM15.2 11.4a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm2.2-1.3a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"
      />
    </svg>
  )
}

export function TriangleGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M8 2.2 14.2 13.4H1.8L8 2.2zm0 2.6L3.9 12.2h8.2L8 4.8z"
      />
    </svg>
  )
}

export interface HandoverView {
  marks: HandoverMarks
  x: number
  y: number
}
