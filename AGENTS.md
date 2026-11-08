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

The app key is public. Vite inlines it from `VITE_APINATOR_APP_KEY` or `APINATOR_APP_KEY` (local `.env`, or the `APINATOR_APP_KEY` repository variable in `.github/workflows/pages.yml`). Keep the key out of source files. The Pages build reads that variable only and fails when it is missing.

`APINATOR_APP_SECRET` is inlined the same way, from `VITE_APINATOR_APP_SECRET` or `APINATOR_APP_SECRET` (local `.env`, or the `APINATOR_APP_SECRET` repository variable). The Pages build fails when it is missing. Keep it out of source files. It is present in the built JavaScript: each private-channel subscription is signed in the browser with the live socket id. That signature is the handshake Apinator requires before it relays client events. It is not an access boundary.

The browser answers `POST /api/realtime/auth` locally and does not send it to GitHub Pages. The Vite dev and preview servers still sign that route when the client bundle has no secret.

A worktree has no `.env`. With no app key, `vite` uses the in-browser mock in `src/apinatorMock.ts`: the connection is local, events reach other tabs on this machine, and nothing is sent to Apinator. Leave the worktree on that mock.

Client events go on private channels, use a `client-*` name, and are not echoed back to the sender. The channel name is what separates sessions. Do not add an invite salt or extra traffic signing.

## Puzzle sessions

The web invite path is `/play/?id=<id>` (a real `play/index.html` on Pages so Telegram and other crawlers get HTTP 200 and can read OG tags). Legacy `/play/<id>` redirects there. New ids are 21-character NanoIDs; older UUIDs still resolve. The channel name is `private-puzzle-<id>`. One channel per session, so a client only sends and receives that session's events. The `private-` prefix is what lets Apinator relay those client events. Knowing the channel name is enough to join.

Setup (image URL, pixel size, piece count, seed) is stored under `jigsaw-session:<id>` and shared with `client-session-request` and `client-session-offer`.

Outer piece edges stay on the image rectangle. Inner edges are the seeded cuts. Load the puzzle image with a plain `Image()` and leave `crossOrigin` unset, or some hosts refuse the request and the picture never appears.

## Telegram Mini App

The site root `https://jigsaw-gg.github.io/` is the Mini App URL in BotFather. Bot username `Jigsaw_GG_Bot`, short name `tg_miniapp`, title `Jigsaw GG`. Deep links:

```text
https://t.me/Jigsaw_GG_Bot/tg_miniapp?startapp=<session-id>
```

Telegram opens the Mini App and injects `start_param` (also available as `tgWebAppStartParam`). The React app reads that, normalizes it, and routes to `/play/?id=…`. No bot backend (webhooks / long polling) is required for launch or invite routing; Apinator still carries game traffic.

Identity is hardcoded as a fallback, overridable locally via `config.json` (`telegram_bot_username`, `telegram_mini_app_short_name`, `telegram_mini_app_title`) and flagged to move to `.env` / CI (`VITE_TELEGRAM_BOT_USERNAME`, `VITE_TELEGRAM_MINI_APP_SHORT_NAME`, `VITE_TELEGRAM_MINI_APP_TITLE`).

Web invites stay on GitHub Pages for link previews. The play page also shows a copyable Telegram deep link. About shows Mini App debug fields.

## GitHub Pages

`base` in `vite.config.ts` stays `/`. The build copies `dist/index.html` to `dist/404.html` so `/network` and `/play/...` survive a refresh, and copies it to `dist/play/index.html` so `/play/?id=…` is a real file for crawlers. `/` is the new-puzzle form, and `/puzzles` redirects there.

If `actions/deploy-pages` returns 404, turn Pages on in the repository settings and set the source to GitHub Actions. The workflow cannot enable Pages itself.
