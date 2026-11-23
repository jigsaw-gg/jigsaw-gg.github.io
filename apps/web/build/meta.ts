import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type WebBuildMeta = {
  /** Full `git rev-parse HEAD` (or `WEB_COMMIT_SHA` when planted). */
  commitSha: string
  /** SHA-256 of sorted tracked file paths + working-tree contents. */
  filesSha: string
}

/** Build-time metadata for OTEL (`web.commit_sha` / `web.files_sha`). */
export function resolveWebBuildMeta(repoRoot: string): WebBuildMeta {
  const plantedCommit = (process.env.WEB_COMMIT_SHA ?? '').trim()
  const plantedFiles = (process.env.WEB_FILES_SHA ?? '').trim()
  return {
    commitSha: plantedCommit || gitHead(repoRoot),
    filesSha: plantedFiles || trackedFilesSha(repoRoot),
  }
}

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

function trackedFilesSha(repoRoot: string): string {
  try {
    const listing = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const paths = listing
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
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
