import { trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { TAB_ID_ATTR } from './attrs.ts'
import { openobserveOtlpHeaders, type OtelConfig } from './config.ts'
import { TAB_ID } from './context.ts'

const SERVICE_NAME = 'jigsaw-gg'

/**
 * Loaded only when an OTLP endpoint is configured (never in production /
 * GitHub Pages builds). Callers must not import this module statically.
 */
export function startOtelSdk(config: OtelConfig): void {
  // Exporter appends `v1/traces` to this base (same as Python OTLP).
  const exporter = new OTLPTraceExporter({
    url: config.endpoint,
    headers: openobserveOtlpHeaders(config.username, config.password),
  })

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [TAB_ID_ATTR]: TAB_ID,
    }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 1000,
        maxExportBatchSize: 64,
      }),
    ],
  })

  provider.register()

  // Smoke span so OpenObserve shows the service before other traffic.
  const tracer = trace.getTracer(SERVICE_NAME)
  const span = tracer.startSpan('otel.startup', {
    attributes: { [TAB_ID_ATTR]: TAB_ID },
  })
  span.end()
  void provider.forceFlush().catch(() => {
    /* OTEL is optional — never fail the app on export errors. */
  })
}

export function getTracer() {
  return trace.getTracer(SERVICE_NAME)
}
