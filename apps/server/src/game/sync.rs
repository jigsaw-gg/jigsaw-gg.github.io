//! Play transports: gRPC `GameSync.Play`, WebSocket `/game`, WebTransport `/game`.

use std::pin::Pin;

use axum::extract::ws::{Message, WebSocket};
use bytes::Bytes;
use futures_util::{SinkExt, Stream, StreamExt};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, Streaming};
use tracing::{Instrument, info, warn};

use crate::game::framing::{FrameReader, encode_frame};
use crate::game::room::PlayerOut;
use crate::game::store::GameStore;
use crate::otel;
use crate::proto::game::v1::game_sync_server::GameSync;
use crate::proto::game::v1::{
    ClientEnvelope, StreamFrame, StreamKind, TransportKind, client_envelope, stream_frame,
};

pub struct GameSyncService {
    store: GameStore,
}

impl GameSyncService {
    pub fn new(store: GameStore) -> Self {
        Self { store }
    }
}

type PlayOutStream = Pin<Box<dyn Stream<Item = Result<StreamFrame, Status>> + Send>>;

#[tonic::async_trait]
impl GameSync for GameSyncService {
    type PlayStream = PlayOutStream;

    async fn play(
        &self,
        request: Request<Streaming<StreamFrame>>,
    ) -> Result<Response<Self::PlayStream>, Status> {
        let mut inbound = request.into_inner();
        let (out_tx, out_rx) = mpsc::channel::<Result<StreamFrame, Status>>(256);

        // Peek first client frame for identity.
        let first = inbound
            .next()
            .await
            .ok_or_else(|| Status::invalid_argument("empty play stream"))?
            .map_err(|e| Status::cancelled(e.to_string()))?;

        let (game_id, player_id, display_name) = identity_from_frame(&first).ok_or_else(|| {
            Status::invalid_argument("first frame must carry ClientEnvelope with ids")
        })?;

        let session_span = otel::game_session_span("GameSync.Play", &game_id, &player_id);
        async {
            let (input_tx, mut input_rx) = mpsc::channel::<StreamFrame>(128);
            let (world_tx, mut world_rx) = mpsc::channel::<StreamFrame>(128);

            let store = self.store.clone();
            let out = PlayerOut {
                input_tx,
                world_tx,
                dual_bidi: false,
                transport: TransportKind::Websocket,
            };

            let welcome = match store
                .attach_player(&game_id, &player_id, &display_name, out)
                .await
            {
                Ok((_, _, welcome)) => welcome,
                Err(err) => {
                    return Err(Status::failed_precondition(err.message()));
                }
            };

            if out_tx.send(Ok(welcome)).await.is_err() {
                return Err(Status::cancelled("client gone"));
            }

            // Merge input/world → single gRPC outbound.
            let merge_tx = out_tx.clone();
            let merge_span = tracing::Span::current();
            tokio::spawn(
                async move {
                    loop {
                        tokio::select! {
                            frame = input_rx.recv() => {
                                match frame {
                                    Some(f) => { if merge_tx.send(Ok(f)).await.is_err() { break; } }
                                    None => break,
                                }
                            }
                            frame = world_rx.recv() => {
                                match frame {
                                    Some(f) => { if merge_tx.send(Ok(f)).await.is_err() { break; } }
                                    None => break,
                                }
                            }
                        }
                    }
                }
                .instrument(merge_span),
            );

            // Process first + remaining frames.
            let room = store.room(&game_id);
            let store_touch = store.clone();
            let gid = game_id.clone();
            let pid = player_id.clone();
            let inbound_span = tracing::Span::current();
            tokio::spawn(
                async move {
                    if let Some(env) = client_envelope_from_frame(&first) {
                        store_touch.touch_activity(&gid);
                        if let Some(room) = &room {
                            room.push_input(&pid, env).await;
                        }
                    }
                    while let Some(Ok(frame)) = inbound.next().await {
                        if let Some(env) = client_envelope_from_frame(&frame) {
                            store_touch.touch_activity(&gid);
                            if let Some(room) = store_touch.room(&gid) {
                                room.push_input(&pid, env).await;
                            }
                        }
                    }
                    if let Some(room) = store_touch.room(&gid) {
                        room.detach(&pid, false).await;
                    }
                }
                .instrument(inbound_span),
            );

            let out: Self::PlayStream = Box::pin(ReceiverStream::new(out_rx));
            Ok(Response::new(out))
        }
        .instrument(session_span)
        .await
    }
}

/// Shared attach path used by WebSocket and WebTransport play handlers.
pub async fn attach_play_session(
    store: &GameStore,
    game_id: &str,
    player_id: &str,
    display_name: &str,
    dual_bidi: bool,
    transport: TransportKind,
) -> Result<
    (
        mpsc::Receiver<StreamFrame>,
        mpsc::Receiver<StreamFrame>,
        StreamFrame,
    ),
    String,
> {
    let (input_tx, input_rx) = mpsc::channel(128);
    let (world_tx, world_rx) = mpsc::channel(128);
    let out = PlayerOut {
        input_tx,
        world_tx,
        dual_bidi,
        transport,
    };
    let (_, _, welcome) = store
        .attach_player(game_id, player_id, display_name, out)
        .await
        .map_err(|e| e.message())?;
    Ok((input_rx, world_rx, welcome))
}

pub async fn handle_websocket_game(
    socket: WebSocket,
    store: GameStore,
    game_id: String,
    player_id: String,
) {
    let span = otel::game_session_span("WebSocket.Play", &game_id, &player_id);
    async move {
        let (mut sink, mut stream) = socket.split();
        let (mut input_rx, mut world_rx, welcome) = match attach_play_session(
            &store,
            &game_id,
            &player_id,
            "",
            false,
            TransportKind::Websocket,
        )
        .await
        {
            Ok(v) => v,
            Err(err) => {
                warn!(%game_id, %player_id, %err, "ws /game attach failed");
                let _ = sink.send(Message::Close(None)).await;
                return;
            }
        };

        info!(%game_id, %player_id, "websocket /game connected");

        if sink
            .send(Message::Binary(encode_frame(&welcome)))
            .await
            .is_err()
        {
            return;
        }

        let mut reader = FrameReader::new();
        let send_span = tracing::Span::current();
        let send_task = tokio::spawn(
            async move {
                loop {
                    tokio::select! {
                        frame = input_rx.recv() => {
                            let Some(frame) = frame else { break; };
                            if sink.send(Message::Binary(encode_frame(&frame))).await.is_err() {
                                break;
                            }
                        }
                        frame = world_rx.recv() => {
                            let Some(frame) = frame else { break; };
                            if sink.send(Message::Binary(encode_frame(&frame))).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
            .instrument(send_span),
        );

        while let Some(Ok(message)) = stream.next().await {
            let payload = match message {
                Message::Binary(b) => b,
                Message::Text(t) => Bytes::from(t),
                Message::Close(_) => break,
                _ => continue,
            };
            reader.push(&payload);
            loop {
                match reader.next_frame() {
                    Ok(Some(frame)) => {
                        if let Some(env) = client_envelope_from_frame(&frame) {
                            store.touch_activity(&game_id);
                            if let Some(room) = store.room(&game_id) {
                                room.push_input(&player_id, env).await;
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(err) => {
                        warn!(%player_id, %err, "bad StreamFrame on ws /game");
                        break;
                    }
                }
            }
        }

        send_task.abort();
        if let Some(room) = store.room(&game_id) {
            room.detach(&player_id, false).await;
        }
        info!(%game_id, %player_id, "websocket /game disconnected");
    }
    .instrument(span)
    .await
}

fn identity_from_frame(frame: &StreamFrame) -> Option<(String, String, String)> {
    let env = client_envelope_from_frame(frame)?;
    if env.game_id.is_empty() || env.player_id.is_empty() {
        return None;
    }
    let display = match &env.body {
        Some(client_envelope::Body::Rename(r)) => r.display_name.clone(),
        _ => String::new(),
    };
    Some((env.game_id, env.player_id, display))
}

pub fn client_envelope_from_frame(frame: &StreamFrame) -> Option<ClientEnvelope> {
    match &frame.body {
        Some(stream_frame::Body::Client(env)) => Some(env.clone()),
        _ => None,
    }
}

pub fn stream_kind(frame: &StreamFrame) -> StreamKind {
    StreamKind::try_from(frame.stream).unwrap_or(StreamKind::Unspecified)
}
