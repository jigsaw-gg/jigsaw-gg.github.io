export type OtelAttributes = Record<
  string,
  string | number | boolean | undefined
>

/** Handle returned by span helpers — always safe to call. */
export type OtelSpan = {
  setAttribute(key: string, value: string | number | boolean): void
  setAttributes(attributes: OtelAttributes): void
  addEvent(name: string, attributes?: OtelAttributes): void
  recordException(error: unknown): void
  setStatus(code: number, message?: string): void
  end(): void
  readonly recording: boolean
}

function cleanAttrs(
  attributes: OtelAttributes | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!attributes) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export const NOOP_SPAN: OtelSpan = {
  setAttribute() {},
  setAttributes() {},
  addEvent() {},
  recordException() {},
  setStatus() {},
  end() {},
  recording: false,
}

/** Minimal span shape from `@opentelemetry/api` — typed locally to avoid importing it here. */
type ApiSpan = {
  setAttribute(key: string, value: string | number | boolean): void
  setAttributes(attributes: Record<string, string | number | boolean>): void
  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void
  recordException(error: Error): void
  setStatus(status: { code: number; message?: string }): void
  end(): void
}

export function wrapSpan(span: ApiSpan): OtelSpan {
  let ended = false
  return {
    recording: true,
    setAttribute(key, value) {
      if (!ended) span.setAttribute(key, value)
    },
    setAttributes(attributes) {
      const cleaned = cleanAttrs(attributes)
      if (!ended && cleaned) span.setAttributes(cleaned)
    },
    addEvent(name, attributes) {
      if (!ended) span.addEvent(name, cleanAttrs(attributes))
    },
    recordException(error) {
      if (ended) return
      if (error instanceof Error) span.recordException(error)
      else span.recordException(new Error(String(error)))
    },
    setStatus(code, message) {
      if (!ended) span.setStatus({ code, message })
    },
    end() {
      if (ended) return
      ended = true
      span.end()
    },
  }
}

export function toOtelAttributes(
  attributes: OtelAttributes | undefined,
): Record<string, string | number | boolean> | undefined {
  return cleanAttrs(attributes)
}
