import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type WebBuildMeta = {
  /** Full `git rev-parse HEAD` (or `WEB_COMMIT_SHA` when planted). */
  commitSha: string
  /** SHA-256 of sorted build-input paths + working-tree contents. */
  filesSha: string
}

/** Build-time metadata for OTEL (`web.commit_sha` / `web.files_sha`). */
export function resolveWebBuildMeta(repoRoot: string): WebBuildMeta {
  const plantedCommit = (process.env.WEB_COMMIT_SHA ?? '').trim()
  const plantedFiles = (process.env.WEB_FILES_SHA ?? '').trim()
  return {
    commitSha: plantedCommit || gitHead(repoRoot),
    filesSha: plantedFiles || webBuildFilesSha(repoRoot),
  }
}

/** Gitignored paths that still affect the web bundle (see `apps/web/vite.config.ts`). */
const GITIGNORED_BUILD_INPUTS = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  'config.json',
] as const

function gitHead(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function gitLsFiles(repoRoot: string, args: string[]): string[] {
  const listing = execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return listing.toString('utf8').split('\0').filter(Boolean)
}

function webBuildInputPaths(repoRoot: string): string[] {
  const paths = new Set<string>()
  for (const rel of gitLsFiles(repoRoot, ['ls-files', '-z'])) paths.add(rel)
  for (const rel of gitLsFiles(repoRoot, [
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
  ])) {
    paths.add(rel)
  }
  for (const rel of GITIGNORED_BUILD_INPUTS) {
    if (existsSync(resolve(repoRoot, rel))) paths.add(rel)
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

function webBuildFilesSha(repoRoot: string): string {
  try {
    const paths = webBuildInputPaths(repoRoot)
    const digest = createHash('sha256')
    for (const rel of paths) {
      digest.update(rel)
      digest.update('\0')
      try {
        digest.update(readFileSync(resolve(repoRoot, rel)))
      } catch {
        try {
          const blob = execFileSync('git', ['hash-object', rel], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim()
          digest.update(blob)
        } catch {
          digest.update('missing')
        }
      }
      digest.update('\0')
    }
    return digest.digest('hex')
  } catch {
    return ''
  }
}
