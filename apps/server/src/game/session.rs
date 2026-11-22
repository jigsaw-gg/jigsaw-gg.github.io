use tonic::{Request, Response, Status};
use tracing::Instrument;

use crate::game::store::{GameStore, StoreError};
use crate::otel;
use crate::proto::game::v1::game_session_server::GameSession;
use crate::proto::game::v1::{
    CreateGameRequest, CreateGameResponse, GetGameRequest, GetGameResponse, JoinGameRequest,
    JoinGameResponse, LeaveGameRequest, LeaveGameResponse,
};

pub struct GameSessionService {
    store: GameStore,
}

impl GameSessionService {
    pub fn new(store: GameStore) -> Self {
        Self { store }
    }
}

#[tonic::async_trait]
impl GameSession for GameSessionService {
    async fn create_game(
        &self,
        request: Request<CreateGameRequest>,
    ) -> Result<Response<CreateGameResponse>, Status> {
        let span = otel::unary_span("GameSession.CreateGame");
        async move {
            let req = request.into_inner();
            otel::record_game_id(&req.game_id);
            let res = self.store.create_game(req).map_err(status_from)?;
            otel::record_game_id(&res.game_id);
            Ok(Response::new(res))
        }
        .instrument(span)
        .await
    }

    async fn get_game(
        &self,
        request: Request<GetGameRequest>,
    ) -> Result<Response<GetGameResponse>, Status> {
        let span = otel::unary_span("GameSession.GetGame");
        async move {
            let game_id = request.into_inner().game_id;
            otel::record_game_id(&game_id);
            self.store
                .get_game(&game_id)
                .map(Response::new)
                .map_err(status_from)
        }
        .instrument(span)
        .await
    }

    async fn join_game(
        &self,
        request: Request<JoinGameRequest>,
    ) -> Result<Response<JoinGameResponse>, Status> {
        let span = otel::unary_span("GameSession.JoinGame");
        async move {
            let req = request.into_inner();
            otel::record_game_id(&req.game_id);
            self.store
                .join_game(req)
                .await
                .map(Response::new)
                .map_err(status_from)
        }
        .instrument(span)
        .await
    }

    async fn leave_game(
        &self,
        request: Request<LeaveGameRequest>,
    ) -> Result<Response<LeaveGameResponse>, Status> {
        let span = otel::unary_span("GameSession.LeaveGame");
        async move {
            let req = request.into_inner();
            otel::record_game_id(&req.game_id);
            self.store
                .leave_game(&req.game_id, &req.player_id)
                .await
                .map(Response::new)
                .map_err(status_from)
        }
        .instrument(span)
        .await
    }
}

fn status_from(err: StoreError) -> Status {
    match err {
        StoreError::NotFound => Status::not_found(err.message()),
        StoreError::Expired => Status::failed_precondition(err.message()),
        StoreError::Conflict(m) => Status::already_exists(m),
        StoreError::Invalid(m) => Status::invalid_argument(m),
    }
}
