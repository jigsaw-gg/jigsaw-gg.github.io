import { context, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'
import type { OtelCategory } from './categories.ts'
import { wrapSpan, type OtelAttributes, type OtelSpan } from './handle.ts'

/** Bound after the SDK loads — keeps `@opentelemetry/api` out of the Pages chunk. */
export function createActiveRuntime(tracer: Tracer) {
  function startSpan(
    _category: OtelCategory,
    name: string,
    attributes?: OtelAttributes,
  ): OtelSpan {
    return wrapSpan(tracer.startSpan(name, { attributes }))
  }

  function withSpan<T>(
    _category: OtelCategory,
    name: string,
    fn: (span: OtelSpan) => T,
    attributes?: OtelAttributes,
  ): T {
    const nested = tracer.startSpan(name, { attributes })
    const handle = wrapSpan(nested)
    return context.with(trace.setSpan(context.active(), nested), () => {
      try {
        const result = fn(handle)
        if (isPromise(result)) {
          return result.then(
            (value) => {
              handle.end()
              return value
            },
            (error: unknown) => {
              handle.recordException(error)
              handle.setStatus(SpanStatusCode.ERROR, errorMessage(error))
              handle.end()
              throw error
            },
          ) as T
        }
        handle.end()
        return result
      } catch (error) {
        handle.recordException(error)
        handle.setStatus(SpanStatusCode.ERROR, errorMessage(error))
        handle.end()
        throw error
      }
    })
  }

  return { startSpan, withSpan }
}

function isPromise<T>(value: T): value is T & Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
