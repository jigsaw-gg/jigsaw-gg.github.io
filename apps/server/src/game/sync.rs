//! Play transports: WebSocket `/game`, WebTransport `/game`.

use axum::extract::ws::{Message, WebSocket};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{Instrument, info, warn};

use crate::game::framing::{FrameReader, encode_frame};
use crate::game::room::PlayerOut;
use crate::game::store::GameStore;
use crate::network_glitch::{NetworkGlitch, OutboundPlan};
use crate::otel;
use crate::proto::game::v1::{
    ClientEnvelope, StreamFrame, StreamKind, TransportKind, stream_frame,
};

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
    network_glitch: NetworkGlitch,
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
        otel::record_game_id(&game_id);

        if sink
            .send(Message::Binary(encode_frame(&welcome)))
            .await
            .is_err()
        {
            return;
        }

        let mut reader = FrameReader::new();
        let glitch_out = network_glitch.clone();
        let send_span = tracing::Span::current();
        let send_task = tokio::spawn(
            async move {
                let mut broken = false;
                loop {
                    if broken {
                        break;
                    }
                    tokio::select! {
                        frame = input_rx.recv() => {
                            let Some(frame) = frame else { break; };
                            let bytes = encode_frame(&frame);
                            let plan = glitch_out.plan_outbound("ws-game-input").await;
                            match plan {
                                OutboundPlan::Drop => {}
                                OutboundPlan::Once | OutboundPlan::Twice => {
                                    if sink.send(Message::Binary(bytes.clone())).await.is_err() {
                                        broken = true;
                                    } else if plan == OutboundPlan::Twice {
                                        glitch_out.duplicate_outbound_delay().await;
                                        if sink.send(Message::Binary(bytes)).await.is_err() {
                                            broken = true;
                                        }
                                    }
                                }
                            }
                        }
                        frame = world_rx.recv() => {
                            let Some(frame) = frame else { break; };
                            let bytes = encode_frame(&frame);
                            let plan = glitch_out.plan_outbound("ws-game-world").await;
                            match plan {
                                OutboundPlan::Drop => {}
                                OutboundPlan::Once | OutboundPlan::Twice => {
                                    if sink.send(Message::Binary(bytes.clone())).await.is_err() {
                                        broken = true;
                                    } else if plan == OutboundPlan::Twice {
                                        glitch_out.duplicate_outbound_delay().await;
                                        if sink.send(Message::Binary(bytes)).await.is_err() {
                                            broken = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .instrument(send_span),
        );

        let glitch_in = network_glitch;
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
                        if glitch_in.impair_inbound().await {
                            continue;
                        }
                        if let Some(env) = client_envelope_from_frame(&frame) {
                            store.touch_activity(&game_id);
                            if let Some(room) = store.room(&game_id) {
                                room.push_input(&player_id, env.clone()).await;
                                let store_in = store.clone();
                                let gid = game_id.clone();
                                let pid = player_id.clone();
                                if glitch_in.should_repeat_inbound().await
                                    && let Some(room) = store_in.room(&gid)
                                {
                                    room.push_input(&pid, env.clone()).await;
                                }
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

pub fn client_envelope_from_frame(frame: &StreamFrame) -> Option<ClientEnvelope> {
    match &frame.body {
        Some(stream_frame::Body::Client(env)) => Some(env.clone()),
        _ => None,
    }
}

pub fn stream_kind(frame: &StreamFrame) -> StreamKind {
    StreamKind::try_from(frame.stream).unwrap_or(StreamKind::Unspecified)
}
