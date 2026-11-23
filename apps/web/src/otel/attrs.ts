/** Searchable on every frontend span (Jaeger / OpenObserve). */
export const TAB_ID_ATTR = 'jigsaw.tab.id'
/** Full HEAD at bundle build; SQL column `web_commit_sha`. */
export const WEB_COMMIT_SHA_ATTR = 'web.commit_sha'
/** Hash of web build inputs at bundle time; SQL column `web_files_sha`. */
export const WEB_FILES_SHA_ATTR = 'web.files_sha'
/** Set while a puzzle play session is active. */
export const SESSION_ID_ATTR = 'jigsaw.session.id'
/** Live play transport while connected (`webtransport` / `websocket`). */
export const TRANSPORT_ATTR = 'jigsaw.transport'
/** Authoritative live-room elapsed ms from `ServerEnvelope.session_elapsed_ms`. */
export const SESSION_ELAPSED_MS_ATTR = 'jigsaw.session.elapsed_ms'
