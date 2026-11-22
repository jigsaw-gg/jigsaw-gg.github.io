use crate::game::{GameSessionService, GameStore, GameSyncService};
use crate::otel;
use crate::proto::game::v1::game_session_server::GameSessionServer;
use crate::proto::game::v1::game_sync_server::GameSyncServer;
use crate::proto::relay::v1::relay_control_server::{RelayControl, RelayControlServer};
use crate::proto::relay::v1::{PingRequest, PongResponse};
use std::net::SocketAddr;
use tonic::{Request, Response, Status};
use tracing::{Instrument, info};

pub struct RelayControlService;

#[tonic::async_trait]
impl RelayControl for RelayControlService {
    async fn ping(&self, request: Request<PingRequest>) -> Result<Response<PongResponse>, Status> {
        let span = otel::unary_span("RelayControl.Ping");
        async move {
            let nonce = request.into_inner().nonce;
            let server_time_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Ok(Response::new(PongResponse {
                nonce,
                server_time_ms,
            }))
        }
        .instrument(span)
        .await
    }
}

pub async fn serve(addr: SocketAddr, games: GameStore) -> anyhow::Result<()> {
    let session = GameSessionService::new(games.clone());
    let sync = GameSyncService::new(games);
    info!(%addr, "gRPC Ping + game plane listening");
    tonic::transport::Server::builder()
        .add_service(RelayControlServer::new(RelayControlService))
        .add_service(GameSessionServer::new(session))
        .add_service(GameSyncServer::new(sync))
        .serve(addr)
        .await?;
    Ok(())
}
