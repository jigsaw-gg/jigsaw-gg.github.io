//! Browser-reachable unary RPCs on the HTTP port (`:21100`).
//!
//! Transports (WebSocket / WebTransport / …) carry bytes. These HTTP paths
//! expose the *RPC* surface from the protos:
//! - `/game.v1.GameSession/{CreateGame,GetGame,JoinGame,LeaveGame}`
//! - `/relay.v1.RelayControl/Ping`
//!
//! Short aliases under `/v1/...` are also registered.
//! Bodies: JSON (`application/json`, camelCase) or protobuf (`application/proto`).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use prost::Message;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tracing::{Instrument, warn};

use crate::game::{GameStore, StoreError};
use crate::otel;
use crate::proto::game::v1::{
    CreateGameRequest, GetGameRequest, JoinGameRequest, LeaveGameRequest,
};
use crate::proto::relay::v1::{PingRequest, PongResponse};

#[derive(Clone)]
pub struct HttpApiState {
    pub games: GameStore,
}

pub fn routes(state: HttpApiState) -> Router {
    Router::new()
        // Connect-style
        .route("/game.v1.GameSession/CreateGame", post(create_game))
        .route("/game.v1.GameSession/GetGame", post(get_game))
        .route("/game.v1.GameSession/JoinGame", post(join_game))
        .route("/game.v1.GameSession/LeaveGame", post(leave_game))
        .route("/relay.v1.RelayControl/Ping", post(relay_ping))
        // Short aliases
        .route("/v1/game/create", post(create_game))
        .route("/v1/game/get", post(get_game))
        .route("/v1/game/join", post(join_game))
        .route("/v1/game/leave", post(leave_game))
        .route("/v1/game/{game_id}", get(get_game_path))
        .route("/v1/relay/ping", post(relay_ping))
        .with_state(Arc::new(state))
}

// ===== GameSession ==========================================================

async fn create_game(
    State(state): State<Arc<HttpApiState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let span = otel::unary_span("GameSession.CreateGame");
    async move {
        match decode_body::<CreateGameRequest>(&headers, &body) {
            Ok((req, fmt)) => {
                otel::record_game_id(&req.game_id);
                match state.games.create_game(req) {
                    Ok(res) => {
                        otel::record_game_id(&res.game_id);
                        encode_body(&res, fmt)
                    }
                    Err(err) => store_error(err, fmt),
                }
            }
            Err(resp) => *resp,
        }
    }
    .instrument(span)
    .await
}

async fn get_game(
    State(state): State<Arc<HttpApiState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let span = otel::unary_span("GameSession.GetGame");
    async move {
        match decode_body::<GetGameRequest>(&headers, &body) {
            Ok((req, fmt)) => {
                otel::record_game_id(&req.game_id);
                match state.games.get_game(&req.game_id) {
                    Ok(res) => encode_body(&res, fmt),
                    Err(err) => store_error(err, fmt),
                }
            }
            Err(resp) => *resp,
        }
    }
    .instrument(span)
    .await
}

async fn get_game_path(
    State(state): State<Arc<HttpApiState>>,
    axum::extract::Path(game_id): axum::extract::Path<String>,
) -> Response {
    let span = otel::unary_span("GameSession.GetGame");
    async move {
        otel::record_game_id(&game_id);
        match state.games.get_game(&game_id) {
            Ok(res) => encode_body(&res, BodyFormat::Json),
            Err(err) => store_error(err, BodyFormat::Json),
        }
    }
    .instrument(span)
    .await
}

async fn join_game(
    State(state): State<Arc<HttpApiState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let span = otel::unary_span("GameSession.JoinGame");
    async move {
        match decode_body::<JoinGameRequest>(&headers, &body) {
            Ok((req, fmt)) => {
                otel::record_game_id(&req.game_id);
                match state.games.join_game(req).await {
                    Ok(res) => encode_body(&res, fmt),
                    Err(err) => store_error(err, fmt),
                }
            }
            Err(resp) => *resp,
        }
    }
    .instrument(span)
    .await
}

async fn leave_game(
    State(state): State<Arc<HttpApiState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let span = otel::unary_span("GameSession.LeaveGame");
    async move {
        match decode_body::<LeaveGameRequest>(&headers, &body) {
            Ok((req, fmt)) => {
                otel::record_game_id(&req.game_id);
                match state.games.leave_game(&req.game_id, &req.player_id).await {
                    Ok(res) => encode_body(&res, fmt),
                    Err(err) => store_error(err, fmt),
                }
            }
            Err(resp) => *resp,
        }
    }
    .instrument(span)
    .await
}

// ===== RelayControl =========================================================

async fn relay_ping(
    State(_state): State<Arc<HttpApiState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let span = otel::unary_span("RelayControl.Ping");
    async move {
        match decode_body::<PingRequest>(&headers, &body) {
            Ok((req, fmt)) => {
                let server_time_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                encode_body(
                    &PongResponse {
                        nonce: req.nonce,
                        server_time_ms,
                    },
                    fmt,
                )
            }
            Err(resp) => *resp,
        }
    }
    .instrument(span)
    .await
}

// ===== Codec ================================================================

#[derive(Clone, Copy)]
enum BodyFormat {
    Json,
    Proto,
}

fn content_format(headers: &HeaderMap) -> BodyFormat {
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json");
    if ct.contains("proto") && !ct.contains("json") {
        BodyFormat::Proto
    } else {
        BodyFormat::Json
    }
}

fn decode_body<T>(headers: &HeaderMap, body: &Bytes) -> Result<(T, BodyFormat), Box<Response>>
where
    T: Message + Default + DeserializeOwned,
{
    let fmt = content_format(headers);
    match fmt {
        BodyFormat::Json => {
            if body.is_empty() {
                return Ok((T::default(), fmt));
            }
            serde_json::from_slice(body)
                .map(|v| (v, fmt))
                .map_err(|err| {
                    warn!(error = %err, "http api json decode failed");
                    Box::new(connect_error(
                        StatusCode::BAD_REQUEST,
                        "invalid_argument",
                        err.to_string(),
                        fmt,
                    ))
                })
        }
        BodyFormat::Proto => T::decode(body.as_ref()).map(|v| (v, fmt)).map_err(|err| {
            warn!(error = %err, "http api proto decode failed");
            Box::new(connect_error(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                err.to_string(),
                fmt,
            ))
        }),
    }
}

fn encode_body<T>(msg: &T, fmt: BodyFormat) -> Response
where
    T: Message + Serialize,
{
    match fmt {
        BodyFormat::Json => match serde_json::to_vec(msg) {
            Ok(bytes) => (
                StatusCode::OK,
                [(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                )],
                bytes,
            )
                .into_response(),
            Err(err) => connect_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                err.to_string(),
                fmt,
            ),
        },
        BodyFormat::Proto => {
            let mut buf = Vec::with_capacity(msg.encoded_len());
            if let Err(err) = msg.encode(&mut buf) {
                return connect_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    err.to_string(),
                    fmt,
                );
            }
            (
                StatusCode::OK,
                [(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/proto"),
                )],
                buf,
            )
                .into_response()
        }
    }
}

fn store_error(err: StoreError, fmt: BodyFormat) -> Response {
    let (status, code) = match &err {
        StoreError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
        StoreError::Expired => (StatusCode::PRECONDITION_FAILED, "failed_precondition"),
        StoreError::Conflict(_) => (StatusCode::CONFLICT, "already_exists"),
        StoreError::Invalid(_) => (StatusCode::BAD_REQUEST, "invalid_argument"),
    };
    connect_error(status, code, err.message(), fmt)
}

fn connect_error(status: StatusCode, code: &str, message: String, fmt: BodyFormat) -> Response {
    #[derive(Serialize)]
    struct ErrBody<'a> {
        code: &'a str,
        message: String,
    }
    match fmt {
        BodyFormat::Json => (
            status,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            serde_json::to_vec(&ErrBody { code, message }).unwrap_or_default(),
        )
            .into_response(),
        BodyFormat::Proto => (
            status,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            )],
            format!("{code}: {message}"),
        )
            .into_response(),
    }
}
