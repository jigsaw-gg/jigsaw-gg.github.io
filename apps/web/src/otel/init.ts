import { readOtelConfig } from './config.ts'
import { configureRuntime } from './runtime.ts'

let started = false

/**
 * Start OTLP export when an endpoint is inlined. No-op in production / Pages
 * builds (Vite forces empty OTEL env) and when the endpoint is unset.
 */
export async function initOtel(): Promise<void> {
  if (started) return
  started = true

  // Production builds replace this with `if (true) return` so the SDK chunk
  // (and `@opentelemetry/api`) is dropped from the GitHub Pages bundle.
  if (import.meta.env.PROD) return

  const config = readOtelConfig()
  if (!config.endpoint) return

  const [{ startOtelSdk, getTracer }, { createActiveRuntime }] =
    await Promise.all([import('./sdk.ts'), import('./active.ts')])
  startOtelSdk(config)
  configureRuntime(config, createActiveRuntime(getTracer()))
}
