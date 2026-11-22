const LEFT_BITS = [
  { top: '8%', delay: '0s', size: '0.85rem', hue: 0 },
  { top: '18%', delay: '0.35s', size: '1.15rem', hue: 1 },
  { top: '28%', delay: '0.7s', size: '0.7rem', hue: 2 },
  { top: '40%', delay: '0.15s', size: '1rem', hue: 0 },
  { top: '52%', delay: '0.9s', size: '0.9rem', hue: 1 },
  { top: '64%', delay: '0.45s', size: '1.2rem', hue: 2 },
  { top: '76%', delay: '1.1s', size: '0.75rem', hue: 0 },
  { top: '88%', delay: '0.55s', size: '1.05rem', hue: 1 },
] as const

const RIGHT_BITS = [
  { top: '12%', delay: '0.2s', size: '1rem', hue: 2 },
  { top: '22%', delay: '0.8s', size: '0.8rem', hue: 0 },
  { top: '34%', delay: '0.4s', size: '1.2rem', hue: 1 },
  { top: '46%', delay: '1s', size: '0.7rem', hue: 2 },
  { top: '58%', delay: '0.25s', size: '1.1rem', hue: 0 },
  { top: '70%', delay: '0.65s', size: '0.85rem', hue: 1 },
  { top: '82%', delay: '0.05s', size: '1.15rem', hue: 2 },
  { top: '92%', delay: '0.75s', size: '0.75rem', hue: 0 },
] as const

export function WinCelebration({ label }: { label: string }) {
  return (
    <div className="win-celebration" role="status" aria-live="polite">
      <div
        className="win-celebration__side win-celebration__side--left"
        aria-hidden="true"
      >
        {LEFT_BITS.map((bit, index) => (
          <span
            key={`l${index}`}
            className={`win-celebration__bit win-celebration__bit--${bit.hue}`}
            style={{
              top: bit.top,
              animationDelay: bit.delay,
              width: bit.size,
              height: bit.size,
            }}
          />
        ))}
      </div>
      <p className="win-celebration__title">{label}</p>
      <div
        className="win-celebration__side win-celebration__side--right"
        aria-hidden="true"
      >
        {RIGHT_BITS.map((bit, index) => (
          <span
            key={`r${index}`}
            className={`win-celebration__bit win-celebration__bit--${bit.hue}`}
            style={{
              top: bit.top,
              animationDelay: bit.delay,
              width: bit.size,
              height: bit.size,
            }}
          />
        ))}
      </div>
    </div>
  )
}
