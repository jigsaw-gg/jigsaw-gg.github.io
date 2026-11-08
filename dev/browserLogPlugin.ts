import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Dev-only browser console stream. `*.log` is gitignored. */
const LOG_FILE = resolve(process.cwd(), 'tmp/browser.log')
const MAX_BYTES = 1_000_000
const KEEP_BYTES = 200_000
const MAX_BODY = 32_768

export function browserLogPlugin(): Plugin {
  return {
    name: 'browser-log',
    apply: 'serve',
    configureServer(server) {
      mkdirSync(resolve(LOG_FILE, '..'), { recursive: true })
      appendFileSync(
        LOG_FILE,
        `\n--- browser log open ${new Date().toISOString()} ---\n`,
      )
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        if (path !== '/__browser-log') {
          next()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        void writeEntry(req, res).catch(() => {
          if (res.writableEnded) return
          res.statusCode = 413
          res.end()
        })
      })
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        const port = address && typeof address === 'object' ? address.port : '?'
        server.config.logger.info(`browser log ${LOG_FILE} (port ${port})`)
      })
    },
  }
}

async function writeEntry(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const raw = await readBody(req)
  const port = req.socket.localPort ?? '?'
  const line = formatLine(port, raw)
  trimIfHuge()
  appendFileSync(LOG_FILE, line)
  res.statusCode = 204
  res.end()
}

function formatLine(port: number | string, raw: string): string {
  const stamp = new Date().toISOString()
  let level = 'log'
  let message = raw.replace(/\s+/g, ' ').trim()
  try {
    const payload = JSON.parse(raw) as { level?: unknown; message?: unknown }
    if (typeof payload.level === 'string' && payload.level)
      level = payload.level
    if (typeof payload.message === 'string') {
      message = payload.message.replace(/\s+/g, ' ').trim()
    }
  } catch {
    // Plain text body.
  }
  if (message.length > 4000) message = `${message.slice(0, 4000)}…`
  return `${stamp} :${port} ${level} ${message}\n`
}

function trimIfHuge(): void {
  let size: number
  try {
    size = statSync(LOG_FILE).size
  } catch {
    return
  }
  if (size <= MAX_BYTES) return
  const data = readFileSync(LOG_FILE)
  writeFileSync(LOG_FILE, data.subarray(data.length - KEEP_BYTES))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_BODY) {
        reject(new Error('browser log body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolveBody(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}
