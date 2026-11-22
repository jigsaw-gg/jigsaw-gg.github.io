# syntax=docker/dockerfile:1
# Build from monorepo root: docker build -f apps/server/Dockerfile .
#
# Optional build args (baked into runtime env for GET /v1/build and About page):
#   BUILD_COMMIT     — short git sha (e.g. first 6 hex chars of HEAD), same as the web client’s BUILD_COMMIT
#   BUILD_COMMIT_LOG — single commit line block from `git log -1 --no-color` (may contain newlines when passed via shell)
#   CARGO_PROFILE    — Cargo profile for the server binary (default fast). Use release for production images.
#
# Example:
#   docker build -f apps/server/Dockerfile \
#     --build-arg BUILD_COMMIT="$(git rev-parse --short=6 HEAD)" \
#     --build-arg BUILD_COMMIT_LOG="$(git --no-pager log -1 --no-color)" \
#     .

FROM rust:1.95-bookworm AS builder
ARG CARGO_PROFILE=fast
WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler cmake pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Layer 1: manifests + protos + build script — rebuild deps only when these change.
COPY Cargo.toml Cargo.lock ./
COPY proto ./proto
COPY apps/server/Cargo.toml apps/server/build.rs ./apps/server/
RUN mkdir -p apps/server/src && printf 'fn main() {}\n' > apps/server/src/main.rs

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    cargo build --profile "${CARGO_PROFILE}" -p jigsaw-gg-server

# Layer 2: application sources — recompiles the crate only (deps stay in target cache).
COPY apps/server/src ./apps/server/src

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    cargo build --profile "${CARGO_PROFILE}" -p jigsaw-gg-server \
    && install -Dm755 "/build/target/${CARGO_PROFILE}/jigsaw-gg-server" /build/out/jigsaw-gg-server

FROM debian:bookworm-slim AS runtime
ARG BUILD_COMMIT=
ARG BUILD_COMMIT_LOG=
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 relay

COPY --from=builder /build/out/jigsaw-gg-server /usr/local/bin/jigsaw-gg-server

RUN mkdir -p /app/certs && chown -R relay:relay /app
USER relay

ENV RUST_LOG=info \
    HTTP_ADDR=0.0.0.0:21100 \
    WEBTRANSPORT_ADDR=0.0.0.0:31100 \
    PUBLIC_HOST=127.0.0.1 \
    CERT_DIR=/app/certs \
    DEFAULT_ROOM=default \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_COMMIT_LOG=${BUILD_COMMIT_LOG}

EXPOSE 21100/tcp 31100/udp

ENTRYPOINT ["jigsaw-gg-server"]
