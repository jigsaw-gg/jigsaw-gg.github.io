# jigsaw-gg-server

Multi-transport game sync + opaque byte relay in Rust.

## Architecture

**Transports** are opaque pipes (bytes in / bytes out):

| Transport               | Role                                            |
| ----------------------- | ----------------------------------------------- |
| **WebTransport** (QUIC) | Primary low-latency pipe                        |
| **WebSocket**           | TCP fallback pipe                               |
| **WebRTC DataChannel**  | Browser DC pipe (setup not in proto; see below) |
| **Raw TCP / UDP**       | Simple socket pipes                             |

**Protos** define application RPCs and framed play messages — not the transports themselves:

| Proto                                    | RPCs                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| [`proto/game.proto`](proto/game.proto)   | `GameSession` lobby + `GameSync.Play` / `StreamFrame` |
| [`proto/relay.proto`](proto/relay.proto) | `RelayControl.Ping` only                              |

Unary RPCs are reachable over **HTTP `:21100`** (browser) and **gRPC `:21101`**. Play frames ride WebTransport `/game` or WebSocket `/game` (length-prefixed `StreamFrame`). Opaque peer relay uses `/ws`, `/relay`, TCP, or UDP without protobuf.

## Ports

| Port    | Proto | Service                                  |
| ------- | ----- | ---------------------------------------- |
| `21100` | TCP   | HTTP RPCs + WebSocket transport          |
| `21101` | TCP   | gRPC (`Ping`, `GameSession`, `GameSync`) |
| `21102` | TCP   | Raw TCP transport                        |
| `31100` | UDP   | WebTransport (QUIC)                      |
| `31101` | UDP   | Raw UDP transport                        |
| `31102` | UDP   | WebRTC ICE / DataChannel                 |

## Quick start (Docker Compose)

From the **monorepo root** (not `apps/server/`):

```bash
docker compose up --build
```

Uses repo-root `.env`, optional `apps/server/.local.env`, and `apps/server/certs/` (same as `./manage.sh run-rust-server-local`). No network-simulation flags.

On Docker Desktop (macOS/Windows), published **UDP** ports can be unreliable from the host; TCP/WebSocket/gRPC work normally. Prefer `cargo run` for local UDP/WebTransport bring-up.

Endpoints:

- `ws://127.0.0.1:21100/ws` — WebSocket opaque relay
- `https://127.0.0.1:31100/relay` — WebTransport opaque relay (self-signed cert in `certs/`)
- `http://127.0.0.1:21100/` — browser unary RPCs (`GameSession` + `Ping`)
- `127.0.0.1:21101` — gRPC
- `127.0.0.1:21102` — raw TCP
- `127.0.0.1:31101` — raw UDP
- `127.0.0.1:31102` — WebRTC UDP

Health check: `GET http://127.0.0.1:21100/healthz`

## Local cargo run

```bash
# requires protoc
cargo run --release
```

Useful env vars / flags: `HTTP_ADDR`, `GRPC_ADDR`, `TCP_ADDR`, `WEBTRANSPORT_ADDR`, `UDP_ADDR`, `WEBRTC_UDP_ADDR`, `PUBLIC_HOST`, `CERT_DIR`, `DEFAULT_ROOM`, `RUST_LOG`.

### UDP network simulation

Impair the raw UDP relay (`:31101`) for local lag testing. JOIN datagrams are never dropped/delayed.

| Flag / env                                          | Default | Meaning                                            |
| --------------------------------------------------- | ------- | -------------------------------------------------- |
| `--net-latency-ms` / `NET_LATENCY_MS`               | `0`     | Mean one-way delay (ms)                            |
| `--net-latency-jitter-ms` / `NET_LATENCY_JITTER_MS` | `0`     | ± uniform jitter around the mean (ms); can reorder |
| `--net-udp-drop-percent` / `NET_UDP_DROP_PERCENT`   | `0`     | Drop chance 0–100                                  |
| `--net-udp-dup-percent` / `NET_UDP_DUP_PERCENT`     | `0`     | Duplicate chance 0–100                             |

Example (~80 ms RTT with jitter and 2 % loss):

```bash
cargo run --release -- \
  --net-latency-ms 40 \
  --net-latency-jitter-ms 15 \
  --net-udp-drop-percent 2
```

## Transports (opaque pipes)

### WebSocket

Connect to `/ws?room=default&client_id=<optional>`. Binary (or text) frames are relayed as-is to other peers in the room.

### WebTransport

Connect to `/relay?room=default&client_id=<optional>`. Datagrams and uni/bi streams carry arbitrary payloads. Outbound fan-out prefers datagrams.

### WebRTC

DataChannel bytes are relayed like other transports once a peer connection exists. SDP/ICE setup is **transport plumbing**, not a `relay.v1` RPC (Signal was removed). Reintroduce a non-proto setup path when browser WebRTC bring-up is needed.

### Raw TCP

Length-prefixed frames: `u32 BE length` + payload. Optional first frame (UTF-8):

```text
JOIN <room> [client_id]
```

### Raw UDP

One datagram = one payload. Peers are keyed by source address. Optional first datagram:

```text
JOIN <room> [client_id]
```

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

## gRPC surface (`:21101`)

- `relay.v1.RelayControl.Ping`
- `game.v1.GameSession` — Create / Get / Join / Leave
- `game.v1.GameSync.Play` — multiplexed `StreamFrame` bidi

Play transports (same in-memory room for every client). JoinGame returns
**path + query only** (`webtransportPath` / `websocketPath`); the client
resolves them against its own WT/WS base URLs:

- WebTransport `/game?game_id=…&player_id=…` — two QUIC bidi streams (input + world)
- WebSocket `/game?game_id=…&player_id=…` — single multiplexed pipe

Games live in process memory with a **24h inactivity TTL**.

## Diagram

```text
  TRANSPORTS (pipes)              RPC / FRAMES (protos)
  ─────────────────               ─────────────────────
  WebSocket /ws  ──┐
  WebTransport     ├── Hub ──── opaque peer broadcast
  TCP / UDP  ──────┘

  HTTP :21100  ──── GameSession + Ping
  gRPC :21101  ──── GameSession + GameSync.Play + Ping

  WT /game  ─────── length-prefixed StreamFrame (game.v1)
  WS /game  ─────── length-prefixed StreamFrame (game.v1)
```

Self-signed TLS material for WebTransport is generated on first boot into `CERT_DIR` (default `./certs`).
