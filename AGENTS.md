# jigsaw-gg

Vite + React + TypeScript jigsaw, deployed as a static site to GitHub Pages at the domain root. There is no application server. A puzzle session is setup cached in `localStorage` plus a private Apinator channel that peers use to share it.

## Commands

- Dev server: `npm run dev`
- Production build (what CI runs): `npm run build`
- Lint: `npm run lint`
- Format: `npm run format`

There is no test runner. For a UI change, run the dev server and use the page.

`uvx pre-commit run -a` runs the repo hooks (whitespace, Prettier, ESLint). `./manage.sh pre-commit` runs that same suite after `git add -A`. Use the wrapper only when the user asked for pre-commit.

## Dev server port

A git worktree does not use Vite's default port. Setup (`.cursor/worktrees.json` → `scripts/setup-worktree.sh`) picks a free port in 20000–49999 and writes it to `.worktree-port`. That file is gitignored and stays with the worktree. Vite reads it and binds `127.0.0.1` with `strictPort`, so the server will not move to another port if this one is busy.

The main checkout has no `.worktree-port`. There, `npm run dev` keeps Vite's default port.

When working in a worktree:

- Read `.worktree-port` before starting the dev server or opening the app. The URL is `http://127.0.0.1:<port>/`.
- Run `npm run dev` or `vite` with no `--port` flag, so the worktree port is the one that is used.
- If `.worktree-port` is missing, run `bash scripts/setup-worktree.sh` from the worktree root. If the file is already present, that script keeps the same port.

## Apinator

The app key is public. Vite inlines it from `VITE_APINATOR_APP_KEY` or `APINATOR_APP_KEY` (local `.env`, or the `APINATOR_APP_KEY` repository secret in `.github/workflows/pages.yml`). Keep the key out of source files.

`APINATOR_APP_SECRET` stays in the Node process. The Vite dev and preview servers use it to sign `POST /api/realtime/auth`. The published site is static and has no such route. Leave the secret out of client code, `define`, and the bundle.

A worktree has no `.env`. With no app key, `vite` uses the in-browser mock in `src/apinatorMock.ts`: the connection is local, events reach other tabs on this machine, and nothing is sent to Apinator. Leave the worktree on that mock.

Client events go on private channels, use a `client-*` name, and are not echoed back to the sender.

## Puzzle sessions

The invite path is `/play/<id>`. New ids are 21-character NanoIDs; older UUIDs still resolve. The channel name is `private-puzzle-<id>`.

Setup (image URL, pixel size, piece count, seed) is stored under `jigsaw-session:<id>` and shared with `client-session-request` and `client-session-offer`.

Outer piece edges stay on the image rectangle. Inner edges are the seeded cuts. Load the puzzle image with a plain `Image()` and leave `crossOrigin` unset, or some hosts refuse the request and the picture never appears.

## GitHub Pages

`base` in `vite.config.ts` stays `/`. The build copies `dist/index.html` to `dist/404.html` so `/puzzles` and `/play/...` survive a refresh.

If `actions/deploy-pages` returns 404, turn Pages on in the repository settings and set the source to GitHub Actions. The workflow cannot enable Pages itself.
