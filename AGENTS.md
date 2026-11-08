# Agent notes

## Dev server port

A git worktree does not use Vite's default port. Setup (`.cursor/worktrees.json` → `scripts/setup-worktree.sh`) picks a free port in 20000–49999 and writes it to `.worktree-port`. That file is gitignored and stays with the worktree. Vite reads it and binds `127.0.0.1` with `strictPort`, so the server will not move to another port if this one is busy.

The main checkout has no `.worktree-port`. There, `npm run dev` keeps Vite's default port.

When working in a worktree:

- Read `.worktree-port` before starting the dev server or opening the app. The URL is `http://127.0.0.1:<port>/`.
- Run `npm run dev` or `vite` with no `--port` flag, so the worktree port is the one that is used.
- If `.worktree-port` is missing, run `bash scripts/setup-worktree.sh` from the worktree root. If the file is already present, that script keeps the same port.
