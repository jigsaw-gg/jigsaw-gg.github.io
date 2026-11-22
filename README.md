# jigsaw-gg

Collaborative jigsaw in the browser, with a Rust multiplayer/sync server. Static client on [GitHub Pages](https://jigsaw-gg.github.io/); game traffic hits the server you configure (`VITE_GAME_*`).

## Repository layout

```text
apps/web/      Vite + React (npm scripts run from repo root)
apps/server/   jigsaw-gg-server (Rust)
proto/         wire contracts (game + relay)
```

Contributor and agent documentation: **[`AGENTS.md`](AGENTS.md)**. Server API and ports: **[`apps/server/README.md`](apps/server/README.md)**. On-site LLM summary (not the repo guide): `apps/web/public/agents.md` → `/agents.md` when deployed.

## Prerequisites

- Node 22+ (`npm ci` at repo root)
- Rust 1.95+ and `protoc` for `apps/server`
- WebTransport locally: `mkcert` files in `apps/server/certs/` (`localhost+1.pem`, `localhost+1-key.pem`)

## Local development

1. Copy or create **`.env`** at the repo root (see `AGENTS.md` for `VITE_GAME_*` and OTEL keys). Defaults target `127.0.0.1:21100` / `:31100`.
2. **Web:** `npm run dev` → open the URL Vite prints (worktrees use `.worktree-port`).
3. **Server:** `./manage.sh run-rust-server-local` (loads `.env` and optional `apps/server/.local.env`).

Or run the server in Docker from the repo root:

```bash
docker compose up --build
```

Optional **`.docker.env`** supplies container-friendly OTLP hosts (`host.docker.internal`); certs are bind-mounted from `apps/server/certs/`.

## Common commands

| Command                             | Purpose                             |
| ----------------------------------- | ----------------------------------- |
| `npm run dev` / `build` / `lint`    | Web app (`apps/web`)                |
| `./manage.sh gen-proto`             | Regenerate TS from `proto/`         |
| `./manage.sh run-rust-server-local` | `cargo run` server with certs + env |
| `docker compose up --build`         | Server in a container               |
| `./manage.sh pre-commit`            | Pre-commit on staged tree           |

## Protocol changes

Edit `proto/*.proto`, then `./manage.sh gen-proto` and rebuild the server (`cargo build --manifest-path apps/server/Cargo.toml`).
