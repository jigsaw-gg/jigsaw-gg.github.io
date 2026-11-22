mod config;
mod game;
mod hub;
mod otel;
mod proto;
mod tls;
mod transport;

use crate::config::Config;
use crate::game::GameStore;
use crate::hub::Hub;
use crate::tls::ensure_dev_certs;
use clap::Parser;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("install rustls crypto provider");

    let provider = otel::init_tracing().map_err(|e| anyhow::anyhow!(e))?;

    let config = Config::parse();
    let tls = ensure_dev_certs(
        &config.cert_dir,
        &config.public_host,
        config.cert_file.as_deref(),
        config.key_file.as_deref(),
    )?;
    let hub = Hub::new(&config);
    let games = GameStore::new();

    info!(
        server_id = %otel::server_id(),
        http = %config.http_addr,
        webtransport = %config.webtransport_addr,
        "starting jigsaw-gg-server"
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

    let result = tokio::select! {
        res = http => res.map_err(|e| anyhow::anyhow!(e)).and_then(|r| r),
        res = webtransport => res.map_err(|e| anyhow::anyhow!(e)).and_then(|r| r),
    };

    if let Some(provider) = provider
        && let Err(err) = provider.shutdown()
    {
        eprintln!("[jigsaw-gg-server] OTEL shutdown error: {err}");
    }

    result
}
