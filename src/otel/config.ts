import { parseEnabledCategories, type OtelCategory } from './categories.ts'

export type OtelConfig = {
  endpoint: string
  username: string
  password: string
  organization: string
  enabledFor: Set<OtelCategory> | 'all'
}

function readEnv(name: keyof ImportMetaEnv): string {
  const raw = import.meta.env[name]
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (value === '' || value === 'undefined' || value === 'null') return ''
  return value
}

/**
 * OpenObserve HTTP base: `http://host/api/<org>`.
 * The JS OTLP exporter appends `/v1/traces`.
 */
export function openobserveOtlpHttpEndpoint(
  base: string,
  organization: string,
): string {
  let endpoint = base.trim().replace(/\/+$/, '')
  const org = organization.trim()
  if (!endpoint) return ''
  if (!endpoint.includes('/api/') && org) {
    endpoint = `${endpoint}/api/${org}`
  }
  return endpoint
}

export function openobserveOtlpHeaders(
  username: string,
  password: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'stream-name': 'default' }
  if (username || password) {
    headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`
  }
  return headers
}

/** Inlined at build time. Production / Pages builds force empty values. */
export function readOtelConfig(): OtelConfig {
  const organization = readEnv('VITE_OTEL_OTEL_EXPORTER_OTLP_ORGANIZATION')
  const rawEndpoint = readEnv('VITE_OTEL_EXPORTER_OTLP_HTTP_ENDPOINT')
  return {
    endpoint: openobserveOtlpHttpEndpoint(rawEndpoint, organization),
    username: readEnv('VITE_OTEL_OTEL_EXPORTER_OTLP_USERNAME'),
    password: readEnv('VITE_OTEL_OTEL_EXPORTER_OTLP_PASSWORD'),
    organization,
    enabledFor: parseEnabledCategories(readEnv('VITE_OTEL_ENABLED_FOR')),
  }
}
