# syntax=docker/dockerfile:1
# Build from monorepo root: docker build -f apps/server/Dockerfile .

FROM rust:1.95-bookworm AS builder
WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler cmake pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY proto ./proto
COPY apps/server/Cargo.toml apps/server/build.rs ./apps/server/
COPY apps/server/src ./apps/server/src

WORKDIR /build/apps/server
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 relay

COPY --from=builder /build/target/release/jigsaw-gg-server /usr/local/bin/jigsaw-gg-server

RUN mkdir -p /app/certs && chown -R relay:relay /app
USER relay

ENV RUST_LOG=info \
    HTTP_ADDR=0.0.0.0:21100 \
    GRPC_ADDR=0.0.0.0:21101 \
    TCP_ADDR=0.0.0.0:21102 \
    WEBTRANSPORT_ADDR=0.0.0.0:31100 \
    UDP_ADDR=0.0.0.0:31101 \
    WEBRTC_UDP_ADDR=0.0.0.0:31102 \
    PUBLIC_HOST=127.0.0.1 \
    CERT_DIR=/app/certs \
    DEFAULT_ROOM=default

EXPOSE 21100/tcp 21101/tcp 21102/tcp 31100/udp 31101/udp 31102/udp

ENTRYPOINT ["jigsaw-gg-server"]
