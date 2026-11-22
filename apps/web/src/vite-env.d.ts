interface ImportMetaEnv {
  /** BotFather bot username (no @). Prefer .env; config.json in local dev. */
  readonly VITE_TELEGRAM_BOT_USERNAME?: string
  /** BotFather Mini App short_name for t.me/<bot>/<short_name>. */
  readonly VITE_TELEGRAM_MINI_APP_SHORT_NAME?: string
  /** Human-readable Mini App title from BotFather. */
  readonly VITE_TELEGRAM_MINI_APP_TITLE?: string
  /** Game lobby HTTP base (Create/Join). */
  readonly VITE_GAME_HTTP_URL?: string
  /** Play WebTransport origin (scheme+host+port); Join paths + relay WT resolve here. */
  readonly VITE_GAME_WEBTRANSPORT_URL?: string
  /** Play WebSocket origin (scheme+host+port); Join paths + relay WS resolve here. */
  readonly VITE_GAME_WEBSOCKET_URL?: string
  /** First 6 characters of the commit planted by the Pages build. */
  readonly VITE_BUILD_COMMIT: string
  /** `git log -1` text planted beside the short commit. */
  readonly VITE_BUILD_COMMIT_LOG: string
  /** OpenObserve / OTLP HTTP base. Empty in production / Pages builds. */
  readonly VITE_OTEL_EXPORTER_OTLP_HTTP_ENDPOINT?: string
  readonly VITE_OTEL_OTEL_EXPORTER_OTLP_USERNAME?: string
  readonly VITE_OTEL_OTEL_EXPORTER_OTLP_PASSWORD?: string
  readonly VITE_OTEL_OTEL_EXPORTER_OTLP_ORGANIZATION?: string
  /** Semicolon-separated categories, or empty/`all` for every category. */
  readonly VITE_OTEL_ENABLED_FOR?: string
}
