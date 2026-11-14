/** Span categories selected by `OTEL_ENABLED_FOR` (semicolon-separated). */
export const OTEL_CATEGORIES = [
  'bootstrap',
  'networking',
  'piece-logic',
  'input',
] as const

export type OtelCategory = (typeof OTEL_CATEGORIES)[number]

const KNOWN = new Set<string>(OTEL_CATEGORIES)

export function parseEnabledCategories(raw: string): Set<OtelCategory> | 'all' {
  const parts = raw
    .split(/[;,]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return 'all'
  if (parts.includes('*') || parts.includes('all')) return 'all'
  const selected = new Set<OtelCategory>()
  for (const part of parts) {
    if (KNOWN.has(part)) selected.add(part as OtelCategory)
  }
  return selected
}

export function categoryEnabled(
  enabled: Set<OtelCategory> | 'all',
  category: OtelCategory,
): boolean {
  return enabled === 'all' || enabled.has(category)
}
