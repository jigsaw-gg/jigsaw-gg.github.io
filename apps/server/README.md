# jigsaw-gg-server

WebTransport + WebSocket game sync in Rust. Lives in the **jigsaw-gg monorepo** at `apps/server/`.

- Agent / contributor guide: [`../../AGENTS.md`](../../AGENTS.md)
- Monorepo overview: [`../../README.md`](../../README.md)

## Architecture

**Transports** are opaque pipes (bytes in / bytes out) or length-prefixed `game.v1` play streams:

| Transport               | Role                     |
| ----------------------- | ------------------------ |
| **WebTransport** (QUIC) | Primary low-latency pipe |
| **WebSocket**           | TCP fallback pipe        |

**Protos** define application RPCs and framed play messages:

| Proto                                          | RPCs                                                  |
| ---------------------------------------------- | ----------------------------------------------------- |
| [`proto/game.proto`](../../proto/game.proto)   | `GameSession` lobby + `GameSync.Play` / `StreamFrame` |
| [`proto/relay.proto`](../../proto/relay.proto) | `RelayControl.Ping` only                              |

Unary RPCs are on **HTTP `:21100`** (browser). Play frames ride WebTransport `/game` or WebSocket `/game` (length-prefixed `StreamFrame`). Opaque peer relay uses `/ws` and `/relay` on the same ports.

## Ports

| Port    | Proto | Service                         |
| ------- | ----- | ------------------------------- |
| `21100` | TCP   | HTTP RPCs + WebSocket transport |
| `31100` | UDP   | WebTransport (QUIC)             |

The Vite client uses `VITE_GAME_HTTP_URL`, `VITE_GAME_WEBSOCKET_URL`, and `VITE_GAME_WEBTRANSPORT_URL` (defaults `http://127.0.0.1:21100`, `ws://127.0.0.1:21100`, `https://127.0.0.1:31100`).

## Quick start (Docker Compose)

From the **monorepo root** (not `apps/server/`):

```bash
docker compose up --build
```

Uses optional repo-root **`.docker.env`**, `apps/server/certs/`, and the same ports as `./manage.sh run-rust-server-local`.

Compose builds the server with the workspace **`fast`** profile (see root `Cargo.toml`) and BuildKit cache mounts so dependency layers survive `src/` edits. For an optimized image: `CARGO_PROFILE=release docker compose build`.

On Docker Desktop (macOS/Windows), published **UDP** ports can be unreliable from the host; TCP/WebSocket work normally. Prefer `cargo run` for local WebTransport bring-up.

Endpoints:

- `ws://127.0.0.1:21100/ws` — WebSocket opaque relay
- `https://127.0.0.1:31100/relay` — WebTransport opaque relay (self-signed cert in `certs/`)
- `http://127.0.0.1:21100/` — browser unary RPCs (`GameSession` + `Ping`)

Health check: `GET http://127.0.0.1:21100/healthz`

Build metadata (for About page): `GET http://127.0.0.1:21100/v1/build` → JSON `{ "commit", "log" }` from `BUILD_COMMIT` and `BUILD_COMMIT_LOG` (Docker build args or runtime env; `./manage.sh run-rust-server-local` plants git when unset).

## Local cargo run

From the **monorepo root** (preferred):

```bash
./manage.sh run-rust-server-local
```

Loads `.env`, optional `apps/server/.local.env`, and mkcert paths under `apps/server/certs/`.

Direct Cargo (same manifest):

```bash
cargo run --manifest-path apps/server/Cargo.toml --profile fast
```

Use `--release` when you need a fully optimized binary; during active development `fast` matches the default Docker compose profile.

Useful env vars / flags: `HTTP_ADDR`, `WEBTRANSPORT_ADDR`, `PUBLIC_HOST`, `CERT_DIR`, `CERT_FILE`, `KEY_FILE`, `DEFAULT_ROOM`, `RUST_LOG`.

### Network glitch (local lag testing)

Optional application-level impairment on play `/game` frames and opaque relay traffic (`/ws`, WebTransport `/relay`). Lobby HTTP RPCs are untouched. Welcome on `/game` is never dropped (only subsequent frames).

| Env                                | Default | Meaning                                                  |
| ---------------------------------- | ------- | -------------------------------------------------------- |
| `NETWORK_GLITCH_LATENCY_MS`        | `0`     | Mean one-way delay (ms)                                  |
| `NETWORK_GLITCH_LATENCY_JITTER_MS` | `0`     | ± uniform jitter around the mean (ms); can reorder       |
| `NETWORK_GLITCH_DROP_PERCENT`      | `0`     | Drop chance 0–100                                        |
| `NETWORK_GLITCH_DUP_PERCENT`       | `0`     | Duplicate chance 0–100 (second send after another delay) |

`./manage.sh run-rust-server-local` loads repo-root `.env` and optional `apps/server/.local.env`, so you can keep glitch knobs in `.local.env`.

## Transports (opaque pipes)

### WebSocket

Connect to `/ws?room=default&client_id=<optional>`. Binary (or text) frames are relayed as-is to other peers in the room.

### WebTransport

Connect to `/relay?room=default&client_id=<optional>`. Datagrams and uni/bi streams carry arbitrary payloads. Outbound fan-out prefers datagrams.

## Browser HTTP API (`:21100`)

Unary RPCs for browsers. `POST` with JSON (`Content-Type: application/json`, camelCase) or protobuf (`application/proto`).

| Method path                            | Alias                                         |
| -------------------------------------- | --------------------------------------------- |
| `POST /game.v1.GameSession/CreateGame` | `POST /v1/game/create`                        |
| `POST /game.v1.GameSession/GetGame`    | `POST /v1/game/get`, `GET /v1/game/{game_id}` |
| `POST /game.v1.GameSession/JoinGame`   | `POST /v1/game/join`                          |
| `POST /game.v1.GameSession/LeaveGame`  | `POST /v1/game/leave`                         |
| `POST /relay.v1.RelayControl/Ping`     | `POST /v1/relay/ping`                         |

Play stays on WS `/game` or WT `/game` (not these unary paths).

Example:

```bash
curl -s http://127.0.0.1:21100/v1/relay/ping -H 'content-type: application/json' -d '{"nonce":"hi"}'
curl -s http://127.0.0.1:21100/game.v1.GameSession/CreateGame \
  -H 'content-type: application/json' \
  -d '{"creatorPlayerId":"p1","setup":{"imageUrl":"https://example/x.jpg","imageWidth":1024,"imageHeight":768,"pieceCount":100,"seed":1}}'
```

Add `"rotationEnabled": true` to `setup` to deal every piece a random quarter turn and let players turn the groups they hold (`RotateHeld` on the play stream). It defaults to `false`.

## Play transports

JoinGame returns **path + query only** (`webtransportPath` / `websocketPath`); the client resolves them against its own WT/WS base URLs:

- WebTransport `/game?game_id=…&player_id=…` — two QUIC bidi streams (input + world)
- WebSocket `/game?game_id=…&player_id=…` — single multiplexed pipe

Games live in process memory with a **24h inactivity TTL**.

## Diagram

```text
  TRANSPORTS (pipes)              RPC / FRAMES (protos)
  ─────────────────               ─────────────────────
  WebSocket /ws  ──┐
  WebTransport     ├── Hub ──── opaque peer broadcast
  /relay       ────┘

  HTTP :21100  ──── GameSession + Ping

  WT /game  ─────── length-prefixed StreamFrame (game.v1)
  WS /game  ─────── length-prefixed StreamFrame (game.v1)
```

Self-signed TLS material for WebTransport is generated on first boot into `CERT_DIR` (default `./certs`).
