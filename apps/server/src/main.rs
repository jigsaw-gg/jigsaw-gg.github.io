mod config;
mod game;
mod grpc;
mod hub;
mod netsim;
mod otel;
mod proto;
mod tls;
mod transport;

use crate::config::Config;
use crate::game::GameStore;
use crate::hub::Hub;
use crate::netsim::NetSim;
use crate::tls::ensure_dev_certs;
use crate::transport::webrtc::WebRtcManager;
use clap::Parser;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("install rustls crypto provider");

    let provider = otel::init_tracing().map_err(|e| anyhow::anyhow!(e))?;

    let config = Config::parse();
    let net_sim = NetSim::from_config(&config)?;
    let tls = ensure_dev_certs(
        &config.cert_dir,
        &config.public_host,
        config.cert_file.as_deref(),
        config.key_file.as_deref(),
    )?;
    let hub = Hub::new(&config);
    let games = GameStore::new();
    // Transport pipe retained; SDP/ICE setup is not a relay.v1 RPC anymore.
    let _webrtc = WebRtcManager::new(hub.clone(), config.webrtc_udp_addr);

    info!(
        server_id = %otel::server_id(),
        http = %config.http_addr,
        grpc = %config.grpc_addr,
        tcp = %config.tcp_addr,
        webtransport = %config.webtransport_addr,
        udp = %config.udp_addr,
        webrtc_udp = %config.webrtc_udp_addr,
        "starting jigsaw-gg-server (transports + RPC)"
    );

    let http_hub = hub.clone();
    let http_games = games.clone();
    let http_addr = config.http_addr;
    let http =
        tokio::spawn(
            async move { transport::websocket::serve(http_addr, http_hub, http_games).await },
        );

    let wt_hub = hub.clone();
    let wt_games = games.clone();
    let wt_addr = config.webtransport_addr;
    let wt_host = config.public_host.clone();
    let wt_tls = tls.clone();
    let webtransport = tokio::spawn(async move {
        transport::webtransport::serve(wt_addr, wt_hub, wt_games, wt_tls, wt_host).await
    });

    let tcp_hub = hub.clone();
    let tcp_addr = config.tcp_addr;
    let tcp = tokio::spawn(async move { transport::tcp::serve(tcp_addr, tcp_hub).await });

    let udp_hub = hub.clone();
    let udp_addr = config.udp_addr;
    let udp = tokio::spawn(async move { transport::udp::serve(udp_addr, udp_hub, net_sim).await });

    let grpc_addr = config.grpc_addr;
    let grpc_games = games.clone();
    let grpc = tokio::spawn(async move { grpc::serve(grpc_addr, grpc_games).await });

    let result = tokio::select! {
        res = http => res.map_err(|e| anyhow::anyhow!(e)).and_then(|r| r),
        res = webtransport => res.map_err(|e| anyhow::anyhow!(e)).and_then(|r| r),
        res = tcp => res.map_err(|e| anyhow::anyhow!(e)).and_then(|r| r),
        res = udp => res.map_err(|e| anyhow::anyhow!(e)).and_then(|r| r),
        res = grpc => res.map_err(|e| anyhow::anyhow!(e)).and_then(|r| r),
    };

    if let Some(provider) = provider
        && let Err(err) = provider.shutdown()
    {
        eprintln!("[jigsaw-gg-server] OTEL shutdown error: {err}");
    }

    result
}
