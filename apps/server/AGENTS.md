# apps/server

Rust game server (`jigsaw-gg-server`). **Canonical monorepo guide:** [`../../AGENTS.md`](../../AGENTS.md) (commands, env, proto, telemetry, client contract).

**Operational detail** (ports, HTTP paths, transports): [`README.md`](README.md).

Quick local run from repo root:

```bash
./manage.sh run-rust-server-local
# or: docker compose up --build
```

Protos compile from repo-root `../../proto/` (`build.rs`); do not add a second `proto/` tree under this crate.
