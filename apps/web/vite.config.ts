import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { browserLogPlugin } from '../../dev/browserLogPlugin.ts'
import { lanHttpsOptions } from '../../dev/devHttps.ts'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(webRoot, '../..')

const SHARE_IMAGE = 'share.png'
const SHARE_IMAGE_HOST = 'https://jigsaw-gg.github.io'
/** Content-hash prefix length for `share.<hash>.png` cache busting on Pages. */
const SHARE_HASH_LEN = 6

/**
 * Hash `public/share.png`, emit `share.<prefix>.png`, and plant that name in
 * absolute OG/Twitter image URLs. GitHub Pages (and Telegram previews) cache
 * aggressively; a stable `/share.png` URL would keep showing a stale image.
 */
function shareImageCacheBust(): Plugin {
  let hashedName = SHARE_IMAGE

  return {
    name: 'share-image-cache-bust',
    apply: 'build',
    buildStart() {
      const source = resolve(webRoot, 'public', SHARE_IMAGE)
      const hash = createHash('sha256')
        .update(readFileSync(source))
        .digest('hex')
        .slice(0, SHARE_HASH_LEN)
      hashedName = `share.${hash}.png`
    },
    transformIndexHtml(html) {
      const from = `${SHARE_IMAGE_HOST}/${SHARE_IMAGE}`
      const to = `${SHARE_IMAGE_HOST}/${hashedName}`
      return html.includes(from) ? html.replaceAll(from, to) : html
    },
    writeBundle() {
      if (hashedName === SHARE_IMAGE) return
      renameSync(
        resolve(webRoot, 'dist', SHARE_IMAGE),
        resolve(webRoot, 'dist', hashedName),
      )
    },
  }
}

/**
 * GitHub Pages serves 404.html for unknown paths with status 404, which
 * drops link previews. Real index.html files under /play and /about return 200
 * (invite OG tags; About in Telegram). 404.html still boots other SPA routes.
 */
function githubPagesSpaFallback(): Plugin {
  return {
    name: 'github-pages-spa-fallback',
    apply: 'build',
    writeBundle() {
      const outDir = resolve(webRoot, 'dist')
      const index = resolve(outDir, 'index.html')
      copyFileSync(index, resolve(outDir, '404.html'))
      for (const dir of ['play', 'about']) {
        const target = resolve(outDir, dir)
        mkdirSync(target, { recursive: true })
        copyFileSync(index, resolve(target, 'index.html'))
      }
    },
  }
}

/**
 * Case-insensitive checkouts (macOS default) cannot hold both `agents.md` and
 * `AGENTS.md` in `public/`. Pages is Linux/case-sensitive, so emit the
 * uppercase twin from the lowercase source at build time.
 */
function duplicateAgentsMd(): Plugin {
  return {
    name: 'duplicate-agents-md',
    apply: 'build',
    writeBundle() {
      const outDir = resolve(webRoot, 'dist')
      copyFileSync(resolve(outDir, 'agents.md'), resolve(outDir, 'AGENTS.md'))
    },
  }
}

/**
 * Short commit and `git log -1` text. The Pages workflow plants
 * BUILD_COMMIT (first 6 characters of GITHUB_SHA) and BUILD_COMMIT_LOG.
 * A local build reads git when those are absent.
 */
function resolveBuildInfo(): { commit: string; log: string } {
  const planted = (process.env.BUILD_COMMIT ?? '').trim()
  if (planted) {
    return {
      commit: planted.slice(0, 6),
      log: (process.env.BUILD_COMMIT_LOG ?? '').trim(),
    }
  }
  try {
    const full = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const log = execFileSync('git', ['--no-pager', 'log', '-1', '--no-color'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return { commit: full.slice(0, 6), log }
  } catch {
    return { commit: '', log: '' }
  }
}

type OtelEnv = {
  endpoint: string
  username: string
  password: string
  organization: string
  enabledFor: string
}

/**
 * Browser OTLP (OpenObserve). Never inlined for production / GitHub Pages —
 * credentials and the exporter stay out of the published bundle.
 * Locally, `.env` may use bare `OTEL_*` or `VITE_OTEL_*` names.
 */
function resolveOtel(mode: string): OtelEnv {
  if (mode === 'production') {
    return {
      endpoint: '',
      username: '',
      password: '',
      organization: '',
      enabledFor: '',
    }
  }
  const fileEnv = loadEnv(mode, repoRoot, '')
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const fromProcess = process.env[key]
      if (typeof fromProcess === 'string' && fromProcess.trim()) {
        return fromProcess.trim()
      }
      const fromFile = fileEnv[key]
      if (typeof fromFile === 'string' && fromFile.trim()) {
        return fromFile.trim()
      }
    }
    return ''
  }
  return {
    endpoint: pick(
      'VITE_OTEL_EXPORTER_OTLP_HTTP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_HTTP_ENDPOINT',
    ),
    username: pick(
      'VITE_OTEL_OTEL_EXPORTER_OTLP_USERNAME',
      'OTEL_OTEL_EXPORTER_OTLP_USERNAME',
    ),
    password: pick(
      'VITE_OTEL_OTEL_EXPORTER_OTLP_PASSWORD',
      'OTEL_OTEL_EXPORTER_OTLP_PASSWORD',
    ),
    organization: pick(
      'VITE_OTEL_OTEL_EXPORTER_OTLP_ORGANIZATION',
      'OTEL_OTEL_EXPORTER_OTLP_ORGANIZATION',
    ),
    enabledFor: pick('VITE_OTEL_ENABLED_FOR', 'OTEL_ENABLED_FOR'),
  }
}

type LocalConfig = {
  telegram_bot_username?: string
  telegram_mini_app_short_name?: string
  telegram_mini_app_title?: string
}

function readLocalConfig(): LocalConfig {
  try {
    return JSON.parse(
      readFileSync(resolve(repoRoot, 'config.json'), 'utf8'),
    ) as LocalConfig
  } catch {
    return {}
  }
}

/**
 * BotFather Mini App identity for deep links.
 *
 * TODO(env): prefer `.env` / CI (`VITE_TELEGRAM_*` or `TELEGRAM_*`). Local
 * `config.json` overrides for worktree/dev. Hardcoded defaults match the
 * published bot until env is wired in the Pages workflow.
 */
function resolveTelegramIdentity(mode: string): {
  bot: string
  app: string
  title: string
} {
  const fileEnv = loadEnv(mode, repoRoot, '')
  const local = readLocalConfig()
  const bot = (
    process.env.VITE_TELEGRAM_BOT_USERNAME ||
    process.env.TELEGRAM_BOT_USERNAME ||
    fileEnv.VITE_TELEGRAM_BOT_USERNAME ||
    fileEnv.TELEGRAM_BOT_USERNAME ||
    local.telegram_bot_username ||
    'Jigsaw_GG_Bot'
  ).trim()
  const app = (
    process.env.VITE_TELEGRAM_MINI_APP_SHORT_NAME ||
    process.env.TELEGRAM_MINI_APP_SHORT_NAME ||
    fileEnv.VITE_TELEGRAM_MINI_APP_SHORT_NAME ||
    fileEnv.TELEGRAM_MINI_APP_SHORT_NAME ||
    local.telegram_mini_app_short_name ||
    'tg_miniapp'
  ).trim()
  const title = (
    process.env.VITE_TELEGRAM_MINI_APP_TITLE ||
    process.env.TELEGRAM_MINI_APP_TITLE ||
    fileEnv.VITE_TELEGRAM_MINI_APP_TITLE ||
    fileEnv.TELEGRAM_MINI_APP_TITLE ||
    local.telegram_mini_app_title ||
    'Jigsaw GG'
  ).trim()
  return { bot, app, title }
}

function worktreeDevPort(): number | undefined {
  try {
    const path = resolve(repoRoot, '.worktree-port')
    const raw = readFileSync(path, 'utf8').trim()
    const port = Number(raw)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
    return port
  } catch {
    return undefined
  }
}

export default defineConfig(({ mode }) => {
  const port = worktreeDevPort()
  const build = resolveBuildInfo()
  const telegram = resolveTelegramIdentity(mode)
  const otel = resolveOtel(mode)
  const https = lanHttpsOptions()
  const worktreeServer =
    port === undefined
      ? undefined
      : { host: '127.0.0.1' as const, port, strictPort: true as const }
  const server =
    worktreeServer || https
      ? {
          ...(worktreeServer ?? {}),
          ...(https ? { https } : {}),
        }
      : undefined
  return {
    root: webRoot,
    envDir: repoRoot,
    // jigsaw-gg.github.io is served from the domain root.
    base: '/',
    server,
    plugins: [
      react(),
      shareImageCacheBust(),
      githubPagesSpaFallback(),
      duplicateAgentsMd(),
      browserLogPlugin(),
    ],
    define: {
      'import.meta.env.VITE_TELEGRAM_BOT_USERNAME': JSON.stringify(
        telegram.bot,
      ),
      'import.meta.env.VITE_TELEGRAM_MINI_APP_SHORT_NAME': JSON.stringify(
        telegram.app,
      ),
      'import.meta.env.VITE_TELEGRAM_MINI_APP_TITLE': JSON.stringify(
        telegram.title,
      ),
      'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(build.commit),
      'import.meta.env.VITE_BUILD_COMMIT_LOG': JSON.stringify(build.log),
      'import.meta.env.VITE_OTEL_EXPORTER_OTLP_HTTP_ENDPOINT': JSON.stringify(
        otel.endpoint,
      ),
      'import.meta.env.VITE_OTEL_OTEL_EXPORTER_OTLP_USERNAME': JSON.stringify(
        otel.username,
      ),
      'import.meta.env.VITE_OTEL_OTEL_EXPORTER_OTLP_PASSWORD': JSON.stringify(
        otel.password,
      ),
      'import.meta.env.VITE_OTEL_OTEL_EXPORTER_OTLP_ORGANIZATION':
        JSON.stringify(otel.organization),
      'import.meta.env.VITE_OTEL_ENABLED_FOR': JSON.stringify(otel.enabledFor),
    },
  }
})
