#!/usr/bin/env bash
# Runs once in a new git worktree. cwd is the worktree root.
# ROOT_WORKTREE_PATH is the main checkout, when the caller provides it.
set -euo pipefail

if [[ -n "${ROOT_WORKTREE_PATH:-}" && ! -e config.json && -f "${ROOT_WORKTREE_PATH}/config.json" ]]; then
  cp "${ROOT_WORKTREE_PATH}/config.json" config.json
fi

if [[ -f .worktree-port ]]; then
  echo "worktree dev port $(tr -d '[:space:]' < .worktree-port)"
  exit 0
fi

node --input-type=module <<'EOF'
import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'

function free(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

const candidates = new Set()
while (candidates.size < 400) {
  candidates.add(20_000 + Math.floor(Math.random() * 30_000))
}

for (const port of candidates) {
  if (!(await free(port))) continue
  writeFileSync('.worktree-port', `${port}\n`)
  console.log(`worktree dev port ${port}`)
  process.exit(0)
}

console.error('no free port for this worktree')
process.exit(1)
EOF
