interface ImportMetaEnv {
  readonly VITE_APINATOR_APP_KEY?: string
  readonly VITE_APINATOR_APP_SECRET?: string
  /** BotFather bot username (no @). Prefer .env; config.json in local dev. */
  readonly VITE_TELEGRAM_BOT_USERNAME?: string
  /** BotFather Mini App short_name for t.me/<bot>/<short_name>. */
  readonly VITE_TELEGRAM_MINI_APP_SHORT_NAME?: string
  /** Human-readable Mini App title from BotFather. */
  readonly VITE_TELEGRAM_MINI_APP_TITLE?: string
  /** First 6 characters of the commit planted by the Pages build. */
  readonly VITE_BUILD_COMMIT: string
  /** `git log -1` text planted beside the short commit. */
  readonly VITE_BUILD_COMMIT_LOG: string
}
