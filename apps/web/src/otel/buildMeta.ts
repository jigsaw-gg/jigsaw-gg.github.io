import {
  WEB_COMMIT_SHA as COMMIT,
  WEB_FILES_SHA as FILES,
} from 'virtual:web-build-meta'

/** From {@link resolveWebBuildMeta} via `virtual:web-build-meta` (refreshed in dev). */
export const WEB_COMMIT_SHA = COMMIT.trim()
export const WEB_FILES_SHA = FILES.trim()

export function buildMetaAttributes(): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (WEB_COMMIT_SHA) attrs['web.commit_sha'] = WEB_COMMIT_SHA
  if (WEB_FILES_SHA) attrs['web.files_sha'] = WEB_FILES_SHA
  return attrs
}
