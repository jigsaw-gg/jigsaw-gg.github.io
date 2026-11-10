import { execFileSync } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { browserLogPlugin } from './dev/browserLogPlugin.ts'
import { lanHttpsOptions } from './dev/devHttps.ts'

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
      const source = resolve('public', SHARE_IMAGE)
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
      renameSync(resolve('dist', SHARE_IMAGE), resolve('dist', hashedName))
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
      const outDir = resolve('dist')
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
 * Public client key. GitHub Actions sets VITE_APINATOR_APP_KEY from the
 * APINATOR_APP_KEY repository variable. Locally, `.env` may use either name.
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

/**
 * Signs private-channel subscriptions in the browser. GitHub Actions sets
 * APINATOR_APP_SECRET from the repository variable of the same name. The
 * signature is Apinator's client-event handshake, not an access boundary.
 */
function resolveAppSecret(mode: string): string {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const raw =
    process.env.VITE_APINATOR_APP_SECRET ||
    process.env.APINATOR_APP_SECRET ||
    fileEnv.VITE_APINATOR_APP_SECRET ||
    fileEnv.APINATOR_APP_SECRET ||
    ''
  return raw.trim()
}

type LocalConfig = {
  telegram_bot_username?: string
  telegram_mini_app_short_name?: string
  telegram_mini_app_title?: string
}

function readLocalConfig(): LocalConfig {
  try {
    return JSON.parse(
      readFileSync(resolve('config.json'), 'utf8'),
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
  const fileEnv = loadEnv(mode, process.cwd(), '')
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

// NanoID from createSessionId, or a previously issued UUID. Keep in sync with session.ts.
const PUZZLE_CHANNEL =
  /^private-puzzle-(?:[A-Za-z0-9_-]{21}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

type ConnectServer = {
  middlewares: {
    use: (
      fn: (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void,
      ) => void,
    ) => void
  }
}

/**
 * Signs private puzzle-channel subscriptions when the client bundle has no
 * secret. The published page signs this route itself.
 */
function apinatorAuthPlugin(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '')
  const appKey = (
    process.env.VITE_APINATOR_APP_KEY ||
    process.env.APINATOR_APP_KEY ||
    env.VITE_APINATOR_APP_KEY ||
    env.APINATOR_APP_KEY ||
    ''
  ).trim()
  const secret = (
    process.env.APINATOR_APP_SECRET ||
    env.APINATOR_APP_SECRET ||
    ''
  ).trim()

  const attach = (server: ConnectServer) => {
    server.middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0]
      if (path !== '/api/realtime/auth') {
        next()
        return
      }
      void signPuzzleChannel(req, res, appKey, secret)
    })
  }

  return {
    name: 'apinator-auth',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

async function signPuzzleChannel(
  req: IncomingMessage,
  res: ServerResponse,
  appKey: string,
  secret: string,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'POST required' })
    return
  }
  if (!appKey || !secret) {
    sendJson(res, 500, { error: 'Apinator auth is not configured' })
    return
  }
  const body = await readBody(req)
  let payload: { socket_id?: unknown; channel_name?: unknown }
  try {
    payload = JSON.parse(body) as {
      socket_id?: unknown
      channel_name?: unknown
    }
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' })
    return
  }
  const socketId = payload.socket_id
  const channelName = payload.channel_name
  if (typeof socketId !== 'string' || typeof channelName !== 'string') {
    sendJson(res, 400, { error: 'socket_id and channel_name are required' })
    return
  }
  if (!PUZZLE_CHANNEL.test(channelName)) {
    sendJson(res, 403, { error: 'Channel is not a puzzle session' })
    return
  }
  const digest = createHmac('sha256', secret)
    .update(`${socketId}:${channelName}`)
    .digest('hex')
  sendJson(res, 200, { auth: `${appKey}:${digest}` })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolveBody(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, string>,
): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
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

function worktreeDevPort(): number | undefined {
  try {
    const path = resolve(
      fileURLToPath(new URL('.', import.meta.url)),
      '.worktree-port',
    )
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
    // jigsaw-gg.github.io is served from the domain root.
    base: '/',
    server,
    plugins: [
      react(),
      shareImageCacheBust(),
      githubPagesSpaFallback(),
      apinatorAuthPlugin(mode),
      browserLogPlugin(),
    ],
    define: {
      'import.meta.env.VITE_APINATOR_APP_KEY': JSON.stringify(
        resolveAppKey(mode),
      ),
      'import.meta.env.VITE_APINATOR_APP_SECRET': JSON.stringify(
        resolveAppSecret(mode),
      ),
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
    },
  }
})
