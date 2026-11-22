use crate::game::GameStore;
use crate::game::handle_websocket_game;
use crate::hub::{Hub, TransportKind};
use crate::transport::http_api::{self, HttpApiState};
use axum::Router;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{debug, info, warn};

#[derive(Clone)]
pub struct HttpState {
    pub hub: Hub,
    pub games: GameStore,
}

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    #[serde(default)]
    pub room: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GameWsQuery {
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub player_id: Option<String>,
}

pub fn router(state: HttpState) -> Router {
    let api = http_api::routes(HttpApiState {
        games: state.games.clone(),
    });
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws", get(ws_upgrade))
        .route("/game", get(game_ws_upgrade))
        .with_state(Arc::new(state))
        .merge(api)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<HttpState>>,
    Query(query): Query<WsQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, query))
}

async fn game_ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<HttpState>>,
    Query(query): Query<GameWsQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        let game_id = query.game_id.unwrap_or_default();
        let player_id = query.player_id.unwrap_or_default();
        if game_id.is_empty() || player_id.is_empty() {
            warn!("ws /game missing game_id or player_id");
            return;
        }
        handle_websocket_game(socket, state.games.clone(), game_id, player_id).await;
    })
}

async fn handle_socket(socket: WebSocket, state: Arc<HttpState>, query: WsQuery) {
    let room = query
        .room
        .unwrap_or_else(|| state.hub.default_room().to_string());
    let (client_id, room, mut outbound) =
        state
            .hub
            .join(room, query.client_id, TransportKind::WebSocket);

    info!(%client_id, %room, "websocket client connected");

    let (mut sink, mut stream) = socket.split();

    let hub = state.hub.clone();
    let client_id_out = client_id.clone();
    let room_out = room.clone();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = outbound.recv().await {
            if sink.send(Message::Binary(msg.payload)).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = stream.next().await {
        match message {
            Message::Binary(payload) => {
                hub.broadcast(&client_id, &room, payload).await;
            }
            Message::Text(text) => {
                hub.broadcast(&client_id, &room, Bytes::from(text)).await;
            }
            Message::Ping(payload) => {
                debug!(%client_id, bytes = payload.len(), "ws ping");
            }
            Message::Close(_) => break,
            Message::Pong(_) => {}
        }
    }

    send_task.abort();
    hub.leave(&room_out, &client_id_out);
    info!(client_id = %client_id_out, room = %room_out, "websocket client disconnected");
}

pub async fn serve(addr: std::net::SocketAddr, hub: Hub, games: GameStore) -> anyhow::Result<()> {
    let app = router(HttpState { hub, games });
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "HTTP/WebSocket + unary API listening");
    axum::serve(listener, app).await?;
    Ok(())
}

#[allow(dead_code)]
fn warn_once(err: impl std::fmt::Display) {
    warn!("websocket error: {err}");
}
