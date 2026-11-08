import { createHmac } from 'node:crypto'
import { copyFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
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
 * Signs private puzzle-channel subscriptions. The app secret stays in this
 * Node process and is never written into the client bundle.
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

export default defineConfig(({ mode }) => ({
  // jigsaw-gg.github.io is served from the domain root.
  base: '/',
  plugins: [react(), githubPagesSpaFallback(), apinatorAuthPlugin(mode)],
  define: {
    'import.meta.env.VITE_APINATOR_APP_KEY': JSON.stringify(
      resolveAppKey(mode),
    ),
  },
}))
