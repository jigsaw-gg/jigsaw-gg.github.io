import { resolve, sep } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { resolveWebBuildMeta } from './meta.ts'

const VIRTUAL_ID = 'virtual:web-build-meta'
const RESOLVED_ID = '\0' + VIRTUAL_ID

const DEBOUNCE_MS = 500

function moduleSource(repoRoot: string): string {
  const { commitSha, filesSha } = resolveWebBuildMeta(repoRoot)
  return [
    `export const WEB_COMMIT_SHA = ${JSON.stringify(commitSha)};`,
    `export const WEB_FILES_SHA = ${JSON.stringify(filesSha)};`,
  ].join('\n')
}

function digest(repoRoot: string): string {
  const { commitSha, filesSha } = resolveWebBuildMeta(repoRoot)
  return `${commitSha}\0${filesSha}`
}

function isIgnoredPath(file: string, repoRoot: string): boolean {
  const p = resolve(file)
  const root = resolve(repoRoot)
  return (
    p.includes(`${resolve(root, 'node_modules')}${sep}`) ||
    p.includes(`${resolve(root, '.git')}${sep}`) ||
    p.includes(`${resolve(root, 'tmp')}${sep}`) ||
    p.includes(`${resolve(root, 'apps/web/dist')}${sep}`)
  )
}

/**
 * Dev: recompute {@link resolveWebBuildMeta} when the virtual module loads and
 * full-reload when the digest changes (any tracked repo file). Build: bundle
 * once per production build.
 */
export function viteBuildMetaPlugin(repoRoot: string): Plugin {
  let lastDigest = ''
  let debounce: ReturnType<typeof setTimeout> | undefined
  let serverRef: ViteDevServer | null = null

  const applyStampRefresh = (server: ViteDevServer): void => {
    const next = digest(repoRoot)
    if (next === lastDigest) return
    lastDigest = next
    const { filesSha } = resolveWebBuildMeta(repoRoot)
    server.config.logger.info(
      `[web-build-meta] digest changed → full reload (web_files_sha ${filesSha.slice(0, 12)}…)`,
    )
    const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
    if (mod) server.moduleGraph.invalidateModule(mod)
    server.ws.send({ type: 'full-reload' })
  }

  const scheduleStampCheck = (): void => {
    if (!serverRef) return
    clearTimeout(debounce)
    debounce = setTimeout(() => applyStampRefresh(serverRef!), DEBOUNCE_MS)
  }

  return {
    name: 'web-build-meta',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID) return moduleSource(repoRoot)
    },
    configureServer(server) {
      serverRef = server
      lastDigest = digest(repoRoot)
      const { filesSha } = resolveWebBuildMeta(repoRoot)
      server.config.logger.info(
        `[web-build-meta] active (web_files_sha ${filesSha.slice(0, 12)}…)`,
      )
      server.watcher.add(repoRoot)
      server.watcher.on('change', (file) => {
        if (isIgnoredPath(file, repoRoot)) return
        scheduleStampCheck()
      })
      server.watcher.on('add', (file) => {
        if (isIgnoredPath(file, repoRoot)) return
        scheduleStampCheck()
      })
      server.watcher.on('unlink', (file) => {
        if (isIgnoredPath(file, repoRoot)) return
        scheduleStampCheck()
      })
    },
    handleHotUpdate({ file, modules }) {
      if (isIgnoredPath(file, repoRoot)) return modules
      scheduleStampCheck()
      return modules
    },
  }
}
