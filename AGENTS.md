# jigsaw-gg

Vite + React + TypeScript jigsaw, deployed as a static site to GitHub Pages at the domain root. There is no application server in this repo. Multiplayer goes through **jigsaw-gg-server**: HTTP lobby (`CreateGame` / `JoinGame`) plus WebTransport or WebSocket `/game` play streams (`game.v1` `StreamFrame`s).

## Commands

- Dev server: `npm run dev`
- Production build (what CI runs): `npm run build`
- Lint: `npm run lint`
- Format: `npm run format`

There is no test runner. For a UI change, run the dev server and use the page.

`uvx pre-commit run -a` runs the repo hooks (whitespace, Prettier, ESLint). `./manage.sh pre-commit` runs that same suite after `git add -A`. Use the wrapper only when the user asked for pre-commit. ESLint includes `eslint-plugin-boundaries` (package import matrix); the `eslint-local` pre-commit hook runs the same `npx eslint .`.

## Source packages

Target layout under `src/`: `core`, `otel`, `network`, `jigsaw`, `world`, `draw`, `input`, `play`, `debug`, `ui`, plus bootstrap `app` (`main.tsx` / `App.tsx`). **Default forbid** cross-package imports; allowed edges and migration notes live in [`dev/architecture.md`](dev/architecture.md). Prefer each package’s `index.ts` as the public surface; impl files must not import their own `index.ts`. Legacy folders (`game/`, `puzzle/`, `components/`, …) remain until migrated and are not boundary-checked yet.

## Dev server port

A git worktree does not use Vite's default port. Setup (`.cursor/worktrees.json` → `scripts/setup-worktree.sh`) picks a free port in 20000–49999 and writes it to `.worktree-port`, then runs `npm ci` when `node_modules/.bin/vite` is missing. `.worktree-port` is gitignored and stays with the worktree. Vite reads it and binds `127.0.0.1` with `strictPort`, so the server will not move to another port if this one is busy.

The main checkout has no `.worktree-port`. There, `npm run dev` keeps Vite's default port.

When working in a worktree:

- Run `bash scripts/setup-worktree.sh` from the worktree root after `git worktree add` (or rely on `.cursor/worktrees.json`). It keeps an existing `.worktree-port` and installs deps when Vite is absent. Do not expect the main checkout's `node_modules` to be available.
- Read `.worktree-port` before starting the dev server or opening the app. The URL is `http://127.0.0.1:<port>/`.
- Run `npm run dev` or `vite` with no `--port` flag, so the worktree port is the one that is used.

## LAN HTTPS (Gamepad / phone)

Chromium only exposes the Gamepad API in a secure context. `http://127.0.0.1` counts; `http://<lan-ip>` does not. For a phone or other LAN client, start Vite with `--host 0.0.0.0` (the local `/spawn-lan-server` skill does this). That host flag turns on the in-repo self-signed listener in `dev/devHttps.ts` (needs system `openssl`). The Network URL is then `https://<lan-ip>:<port>/`. Accept the certificate warning once.

Do not add a separate HTTPS npm package for this. Cert material is written under `tmp/` (`dev-key.pem`, `dev-cert.pem`); that directory is gitignored — never commit it.

## OpenTelemetry (local / worktree only)

The browser exports traces directly to OpenObserve over OTLP/HTTP when
`OTEL_EXPORTER_OTLP_HTTP_ENDPOINT` is set (same env shape as
`openttd-private` grpc/python controllers: Basic auth from
`OTEL_OTEL_EXPORTER_OTLP_{USERNAME,PASSWORD}`, org in the `/api/<org>` path via
`OTEL_OTEL_EXPORTER_OTLP_ORGANIZATION`).

`OTEL_ENABLED_FOR` is a semicolon-separated category list
(`bootstrap`, `networking`, `piece-logic`, `input`). Empty or `all` enables
every category. Call sites always use `withSpan` / `event` / `startSpan` from
`src/otel/` — they never branch on whether OTEL is on; the helpers no-op when
the endpoint is missing or the category is filtered.

Every span carries `jigsaw.tab.id` (new ULID-like id per document load). While
a play session is mounted, spans also carry `jigsaw.session.id`. A small
bottom-left overlay shows those ids in local/dev when OTEL is configured; it
is omitted from production / GitHub Pages builds.

Production / GitHub Pages builds force all OTEL env values empty and skip
loading the SDK chunk (`import.meta.env.PROD`), so credentials never ship in
the published bundle. OpenObserve must allow browser CORS for local ingest.

## Telemetry (OpenObserve)

Local client and `jigsaw-gg-server` both export into the same traces stream
(`default`, org `default`). Use the `user-openobserve` MCP (`SearchSQL` with
`type: "traces"`). Attribute dots flatten to underscores in SQL columns.
`start_time` / `end_time` are **microseconds**; prefer the last 1–2 hours (or
`StreamSchema` → `doc_time_min` / `doc_time_max` when unsure).

**Search pitfalls (not obvious from the UI):**

- `StreamSchema.doc_time_max` can lag ingest. Using it as `SearchSQL`
  `end_time` will return **zero hits** for a session the OpenObserve UI still
  shows. If the user (or UI) finds spans and MCP does not, widen `end_time`
  well past `doc_time_max` (or use “now” / a generous upper bound) and retry
  before concluding the session id is wrong.
- Prefer a count / `GROUP BY` first
  (`jigsaw_session_id = '…' OR game_id = '…'`) to confirm the window, then
  aggregates (`histogram(_timestamp, '1 second')`, min/max/avg of `x`/`y`).
  Do not dump raw `cursor.local` / `cursor.remote` rows unless aggregates are
  not enough.
- Client session filter: `jigsaw_session_id`. Server: `game_id`. Same string;
  OR them when scanning both services in one query.

**Ids (from the bottom-left OTEL overlay or a bug report):**

| Overlay / URL         | Client column                                             | Server column                   |
| --------------------- | --------------------------------------------------------- | ------------------------------- |
| Session / play `?id=` | `jigsaw_session_id` (also `jigsaw_game_id` on some spans) | `game_id` — same string         |
| Tab                   | `jigsaw_tab_id`                                           | _(none — server has no tab id)_ |
| Player (NanoID)       | `jigsaw_player_id`                                        | `player_id`                     |

`service_name`: browser = `jigsaw-gg`, server = `jigsaw-gg-server`.

**1. Client spans for a session (all tabs):**

```sql
SELECT _timestamp, operation_name, jigsaw_tab_id, jigsaw_transport,
       jigsaw_player_id, pieceid, granted, denied
FROM "default"
WHERE jigsaw_session_id = '<SESSION_ID>'
ORDER BY _timestamp ASC
```

**2. One tab only:** add `AND jigsaw_tab_id = '<TAB_ID>'`. Useful operations:
`piece.drag_start` / `piece.drag_end`, `game.claim.send` / `game.claim.result`,
`game.play.connect`, `game.play.welcome`, `game.presence`.

Cursor path (category `input`, ~20 Hz max): mover tab emits `cursor.local`
(`x`/`y` human pointer). Observer tab emits `cursor.remote` (`x`/`y` after
presentation smoother, `targetX`/`targetY` delayed chase point from
`MousePathSmoother`, `remotePlayerId`). A sane `target*` with wild `x`/`y`
points at the smoother, not the wire. Compare the same wall-clock window
across both `jigsaw_tab_id`s; stationary mover gaps (no `cursor.local`) with
continuing `cursor.remote` are the usual bounce/lag windows.

**3. Map tab → player_id** (needed for server queries):

```sql
SELECT jigsaw_tab_id, jigsaw_player_id, operation_name
FROM "default"
WHERE jigsaw_session_id = '<SESSION_ID>'
  AND jigsaw_player_id IS NOT NULL
  AND jigsaw_player_id != ''
```

Prefer rows like `game.session.live`, `game.world.ready`, or `game.join`.

**4. Related server spans** (same game; optional player filter):

```sql
SELECT _timestamp, operation_name, game_id, player_id
FROM "default"
WHERE service_name = 'jigsaw-gg-server'
  AND game_id = '<SESSION_ID>'
ORDER BY _timestamp ASC
```

Narrow with `AND player_id = '<PLAYER_ID>'` from step 3. Typical names:
`claim`, `release`, `move_held`, `client_envelope`, `rpc.game_session`,
`rpc.unary`.

**5. Side-by-side window:** take mover `piece.drag_start`…`piece.drag_end`
`_timestamp`s from the client query, then re-run the server query with
`_timestamp` between those bounds (and a little slack). Compare claim/move_held
on the server with what the observer tab did or did not emit.

`GetLatestTraces` can list recent traces, but for session/tab filters prefer
`SearchSQL` as above.

## Protocol contract (client ↔ server)

`proto/game.proto` is the source of truth for play-stream semantics (copied
from `jigsaw-gg-server` via `./scripts/gen-proto.sh`). When the server does
something the client did not expect — or the reverse — **document the intended
behavior in that proto** (message/field comments), then align the
implementation to the comment. Prefer fixing the side that violates the
contract; the server is easy to change. Do not paper over ambiguity with a
client-only workaround that leaves the wire meaning unclear.

Motion (`MotionSample`) is the usual hotspot: `absolute` / relative quanta,
`hide` vs clearing a hold, and Tick `holdings` vs `PlayerPose.held`. Read those
comments before changing drag/cursor sync. Until the server trajectory honors
`absolute=false` deltas, client cursor uplink keeps `absoluteEveryMs: 0` (all
absolute knots) so remotes do not teleport near the origin between absolute
samples.

## Game server

Lobby unaries (JSON or protobuf) on the HTTP port, e.g. `POST /v1/game/create`, `/v1/game/join`, `GET /v1/game/{id}`. Play: client owns WT/WS **bases** (scheme/host/port); `JoinGame` returns **path+query only** (`PlayEndpoints.webtransport_path` / `websocket_path`, e.g. `/game?…`). Client resolves those against its bases, then opens length-prefixed `StreamFrame`s on WT (two bidi streams) or WS (multiplexed). Server may change the path; it must not send another hostname/port.

Client config (local `.env` or Pages variables):

- `VITE_GAME_HTTP_URL` — lobby base (`http://127.0.0.1:21100` locally)
- `VITE_GAME_WEBTRANSPORT_URL` / `VITE_GAME_WEBSOCKET_URL` — play + relay origins (scheme/host/port). Relay probe appends `/relay` and `/ws`.

Proto sources live in `jigsaw-gg-server`; `./scripts/gen-proto.sh` copies them and regenerates `src/network/gen/*_pb.ts`. Keep `proto/game.proto` in sync with the server.

A worktree may copy `.env` from the main checkout via `scripts/setup-worktree.sh`. Point that env at a running local `jigsaw-gg-server`.

## Puzzle sessions

The web invite path is `/play/?id=<id>` (a real `play/index.html` on Pages so Telegram and other crawlers get HTTP 200 and can read OG tags). Legacy `/play/<id>` redirects there. New ids are 26-character ULID-like Crockford strings (letter-first, fully random — no timestamp ordering); older 21-character NanoIDs and UUIDs still resolve. The host calls `CreateGame` with that id before navigating; every client (including the host) `JoinGame`s and opens play streams.

Setup is also cached under `jigsaw-session:<id>` (and world under `jigsaw-world:…`) with a **24h inactivity** TTL. Server memory TTL matches. Cache is not a substitute for Create/Join.

Outer piece edges stay on the image rectangle. Inner edges are the seeded cuts. Load the puzzle image with a plain `Image()` and leave `crossOrigin` unset, or some hosts refuse the request and the picture never appears.

## Telegram Mini App

The site root `https://jigsaw-gg.github.io/` is the Mini App URL in BotFather. Bot username `Jigsaw_GG_Bot`, short name `tg_miniapp`, title `Jigsaw GG`. Deep links:

```text
https://t.me/Jigsaw_GG_Bot/tg_miniapp?startapp=<session-id>
```

Telegram opens the Mini App and injects `start_param` (also available as `tgWebAppStartParam`). The React app reads that, normalizes it, and routes to `/play/?id=…`. No bot backend (webhooks / long polling) is required for launch or invite routing; the game server carries play traffic.

Identity is hardcoded as a fallback, overridable locally via `config.json` (`telegram_bot_username`, `telegram_mini_app_short_name`, `telegram_mini_app_title`) and flagged to move to `.env` / CI (`VITE_TELEGRAM_BOT_USERNAME`, `VITE_TELEGRAM_MINI_APP_SHORT_NAME`, `VITE_TELEGRAM_MINI_APP_TITLE`).

Web invites stay on GitHub Pages for link previews. The play page also shows a copyable Telegram deep link. About shows Mini App debug fields.

## GitHub Pages

`base` in `vite.config.ts` stays `/`. The build copies `dist/index.html` to `dist/404.html` so `/network` and other SPA paths survive a refresh, and copies it to `dist/play/index.html` and `dist/about/index.html` so `/play/?id=…` and `/about` are real files (200 for crawlers / Telegram). `/` is the new-puzzle form, and `/puzzles` redirects there.

If `actions/deploy-pages` returns 404, turn Pages on in the repository settings and set the source to GitHub Actions. The workflow cannot enable Pages itself.
