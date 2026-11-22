use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Debug, Clone, Parser)]
#[command(
    name = "jigsaw-gg-server",
    about = "WebTransport + WebSocket game sync server"
)]
pub struct Config {
    /// HTTP unary API + WebSocket listen address
    #[arg(long, env = "HTTP_ADDR", default_value = "0.0.0.0:21100")]
    pub http_addr: SocketAddr,

    /// WebTransport (HTTP/3 / QUIC) listen address
    #[arg(long, env = "WEBTRANSPORT_ADDR", default_value = "0.0.0.0:31100")]
    pub webtransport_addr: SocketAddr,

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
}
