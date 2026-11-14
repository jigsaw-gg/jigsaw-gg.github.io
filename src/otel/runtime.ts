import { categoryEnabled, type OtelCategory } from './categories.ts'
import { readOtelConfig, type OtelConfig } from './config.ts'
import { contextAttributes } from './context.ts'
import {
  NOOP_SPAN,
  toOtelAttributes,
  type OtelAttributes,
  type OtelSpan,
} from './handle.ts'

type ActiveRuntime = {
  startSpan: (
    category: OtelCategory,
    name: string,
    attributes?: OtelAttributes,
  ) => OtelSpan
  withSpan: <T>(
    category: OtelCategory,
    name: string,
    fn: (span: OtelSpan) => T,
    attributes?: OtelAttributes,
  ) => T
}

let config: OtelConfig | null = null
let active: ActiveRuntime | null = null

export function configureRuntime(
  next: OtelConfig,
  nextActive: ActiveRuntime,
): void {
  config = next
  active = nextActive
}

function activeFor(category: OtelCategory): boolean {
  return Boolean(
    active &&
    config &&
    config.endpoint &&
    categoryEnabled(config.enabledFor, category),
  )
}

/**
 * Open a span. Always safe — returns a no-op when OTEL is off or the category
 * is filtered by `OTEL_ENABLED_FOR`. Call sites must not branch on OTEL state.
 */
export function startSpan(
  category: OtelCategory,
  name: string,
  attributes?: OtelAttributes,
): OtelSpan {
  if (!activeFor(category) || !active) return NOOP_SPAN
  return active.startSpan(category, name, {
    ...contextAttributes(),
    'jigsaw.otel.category': category,
    ...toOtelAttributes(attributes),
  })
}

/**
 * Run `fn` inside a span. Ends the span when `fn` returns, or when a returned
 * Promise settles. Always invoke this — filtering is internal.
 */
export function withSpan<T>(
  category: OtelCategory,
  name: string,
  fn: (span: OtelSpan) => T,
  attributes?: OtelAttributes,
): T {
  if (!activeFor(category) || !active) return fn(NOOP_SPAN)
  return active.withSpan(category, name, fn, {
    ...contextAttributes(),
    'jigsaw.otel.category': category,
    ...toOtelAttributes(attributes),
  })
}

/** Instant marker span (open + end). */
export function event(
  category: OtelCategory,
  name: string,
  attributes?: OtelAttributes,
): void {
  startSpan(category, name, attributes).end()
}

/** True when endpoint is configured (dev only — production inlines empty). */
export function otelConfigured(): boolean {
  return Boolean(readOtelConfig().endpoint)
}
