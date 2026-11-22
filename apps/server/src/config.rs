use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Debug, Clone, Parser)]
#[command(
    name = "jigsaw-gg-server",
    about = "Multi-transport relay / game sync server"
)]
pub struct Config {
    /// HTTP unary API + WebSocket listen address
    #[arg(long, env = "HTTP_ADDR", default_value = "0.0.0.0:21100")]
    pub http_addr: SocketAddr,

    /// gRPC listen address (Ping + GameSession + GameSync)
    #[arg(long, env = "GRPC_ADDR", default_value = "0.0.0.0:21101")]
    pub grpc_addr: SocketAddr,

    /// Raw TCP relay listen address
    #[arg(long, env = "TCP_ADDR", default_value = "0.0.0.0:21102")]
    pub tcp_addr: SocketAddr,

    /// WebTransport (HTTP/3 / QUIC) listen address
    #[arg(long, env = "WEBTRANSPORT_ADDR", default_value = "0.0.0.0:31100")]
    pub webtransport_addr: SocketAddr,

    /// Raw UDP relay listen address
    #[arg(long, env = "UDP_ADDR", default_value = "0.0.0.0:31101")]
    pub udp_addr: SocketAddr,

    /// WebRTC ICE / DataChannel UDP bind address (transport pipe; no proto signaling)
    #[arg(long, env = "WEBRTC_UDP_ADDR", default_value = "0.0.0.0:31102")]
    pub webrtc_udp_addr: SocketAddr,

    /// Public hostname for TLS SANs / listen logs (not returned in JoinGame play paths)
    #[arg(long, env = "PUBLIC_HOST", default_value = "localhost")]
    pub public_host: String,

    /// Directory for TLS certificate / key (generated if missing)
    #[arg(long, env = "CERT_DIR", default_value = "certs")]
    pub cert_dir: PathBuf,

    /// TLS certificate PEM path (optional; overrides CERT_DIR lookup)
    #[arg(long, env = "CERT_FILE")]
    pub cert_file: Option<PathBuf>,

    /// TLS private key PEM path (optional; must be set together with CERT_FILE)
    #[arg(long, env = "KEY_FILE")]
    pub key_file: Option<PathBuf>,

    /// Default room used when a client does not specify one
    #[arg(long, env = "DEFAULT_ROOM", default_value = "default")]
    pub default_room: String,

    /// Max datagram / frame size in bytes
    #[arg(long, env = "MAX_PAYLOAD_BYTES", default_value_t = 65_535)]
    pub max_payload_bytes: usize,

    // ── Network simulation (raw UDP relay only) ───────────────────────────
    /// Simulated mean one-way latency for UDP datagrams (milliseconds).
    /// Combined with `--net-latency-jitter-ms` as a uniform delay around the mean.
    #[arg(long, env = "NET_LATENCY_MS", default_value_t = 0)]
    pub net_latency_ms: u64,

    /// Latency spread / jitter half-range in milliseconds (± around mean, floored at 0).
    /// Independent per-datagram delays can reorder packets when jitter is non-zero.
    #[arg(long, env = "NET_LATENCY_JITTER_MS", default_value_t = 0)]
    pub net_latency_jitter_ms: u64,

    /// Percentage of UDP data datagrams to drop (0–100). JOIN packets are never dropped.
    #[arg(long, env = "NET_UDP_DROP_PERCENT", default_value_t = 0.0)]
    pub net_udp_drop_percent: f64,

    /// Percentage of UDP data datagrams to duplicate after the delay (0–100).
    #[arg(long, env = "NET_UDP_DUP_PERCENT", default_value_t = 0.0)]
    pub net_udp_dup_percent: f64,
}
