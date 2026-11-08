import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** GitHub Pages serves 404.html for unknown paths and keeps the request URL. */
function githubPagesSpaFallback(): Plugin {
  return {
    name: 'github-pages-spa-fallback',
    apply: 'build',
    writeBundle() {
      const outDir = resolve('dist')
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
    },
  }
}

/**
 * Public client key. GitHub Actions sets VITE_APINATOR_APP_KEY from the
 * APINATOR_APP_KEY secret. Locally, `.env` may use either name.
 * APINATOR_APP_SECRET is never forwarded into the client bundle.
 */
function resolveAppKey(mode: string): string {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const raw =
    process.env.VITE_APINATOR_APP_KEY ||
    process.env.APINATOR_APP_KEY ||
    fileEnv.VITE_APINATOR_APP_KEY ||
    fileEnv.APINATOR_APP_KEY ||
    ''
  return raw.trim()
}

export default defineConfig(({ mode }) => ({
  // jigsaw-gg.github.io is served from the domain root.
  base: '/',
  plugins: [react(), githubPagesSpaFallback()],
  define: {
    'import.meta.env.VITE_APINATOR_APP_KEY': JSON.stringify(
      resolveAppKey(mode),
    ),
  },
}))
