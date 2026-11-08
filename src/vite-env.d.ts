interface ImportMetaEnv {
  readonly VITE_APINATOR_APP_KEY?: string
  readonly VITE_APINATOR_APP_SECRET?: string
  /** First 6 characters of the commit planted by the Pages build. */
  readonly VITE_BUILD_COMMIT: string
  /** `git log -1` text planted beside the short commit. */
  readonly VITE_BUILD_COMMIT_LOG: string
}
