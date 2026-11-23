use crate::game::GameStore;
use crate::game::framing::{FrameReader, encode_frame};
use crate::game::sync::{attach_play_session, client_envelope_from_frame, stream_kind};
use crate::hub::{Hub, TransportKind};
use crate::network_glitch::{NetworkGlitch, OutboundPlan};
use crate::otel;
use crate::proto::game::v1::{StreamKind, TransportKind as GameTransportKind};
use crate::tls::TlsMaterial;
use anyhow::Context;
use bytes::Bytes;
use std::net::SocketAddr;
use std::time::Duration;
use tracing::{Instrument, info, warn};
use wtransport::endpoint::IncomingSession;
use wtransport::{Endpoint, Identity, ServerConfig};

pub async fn serve(
    addr: SocketAddr,
    hub: Hub,
    games: GameStore,
    tls: TlsMaterial,
    public_host: String,
    network_glitch: NetworkGlitch,
) -> anyhow::Result<()> {
    let identity = Identity::load_pemfiles(&tls.cert_path, &tls.key_path)
        .await
        .context("load WebTransport TLS identity")?;

    let config = ServerConfig::builder()
        .with_bind_address(addr)
        .with_identity(identity)
        .max_idle_timeout(Some(Duration::from_secs(30)))?
        .keep_alive_interval(Some(Duration::from_secs(5)))
        .build();

    let server = Endpoint::server(config)?;
    info!(
        %addr,
        relay = format!("https://{public_host}:{}/relay", addr.port()),
        game = format!("https://{public_host}:{}/game", addr.port()),
        "WebTransport listening"
    );

    loop {
        let incoming = server.accept().await;
        let hub = hub.clone();
        let games = games.clone();
        let glitch = network_glitch.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_session(incoming, hub, games, glitch).await {
                warn!(error = %err, "WebTransport session ended with error");
            }
        });
    }
}

async fn handle_session(
    incoming: IncomingSession,
    hub: Hub,
    games: GameStore,
    network_glitch: NetworkGlitch,
) -> anyhow::Result<()> {
    let request = incoming.await?;
    let path = request.path().to_string();
    info!(
        authority = %request.authority(),
        path = %path,
        "WebTransport session request"
    );

    let connection = request.accept().await?;

    if path_is_game(&path) {
        handle_game_session(connection, games, &path, network_glitch).await
    } else {
        handle_relay_session(connection, hub, &path, network_glitch).await
    }
}

fn path_is_game(path: &str) -> bool {
    let path_only = path.split('?').next().unwrap_or(path);
    path_only == "/game" || path_only.ends_with("/game")
}

async fn handle_game_session(
    connection: wtransport::Connection,
    games: GameStore,
    path: &str,
    network_glitch: NetworkGlitch,
) -> anyhow::Result<()> {
    let (game_id, player_id) = parse_game_query(path);
    if game_id.is_empty() || player_id.is_empty() {
        anyhow::bail!("/game requires game_id and player_id query params");
    }

    let span = otel::game_session_span("WebTransport.Play", &game_id, &player_id);
    async move {
        let (mut input_rx, mut world_rx, welcome) = attach_play_session(
            &games,
            &game_id,
            &player_id,
            "",
            true,
            GameTransportKind::Webtransport,
        )
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

        otel::record_game_id(&game_id);
        info!(%game_id, %player_id, "WebTransport /game connected — waiting for input+world streams");

        // Expect two bidirectional streams; role from first frame StreamKind (or order).
        let (send_a, recv_a) = connection.accept_bi().await?;
        let (send_b, recv_b) = connection.accept_bi().await?;

        let mut reader_a = FrameReader::new();
        let mut reader_b = FrameReader::new();
        let mut buf_a = vec![0u8; 65_536];
        let mut buf_b = vec![0u8; 65_536];

        // Classify streams: peek first frame on each (non-blocking race with timeout).
        // Until classified, buffer; default: first accepted = input, second = world.
        let mut input_send = send_a;
        let mut world_send = send_b;
        let mut input_recv = recv_a;
        let mut world_recv = recv_b;
        let mut classified = false;

        // Send Welcome on world immediately once we know world_send.
        // We'll re-send after classification if swapped.
        let _ = world_send.write_all(encode_frame(&welcome).as_ref()).await;

        let games2 = games.clone();
        let gid = game_id.clone();
        let pid = player_id.clone();
        let glitch_in = network_glitch.clone();
        let glitch_out = network_glitch;

        loop {
            tokio::select! {
                result = input_recv.read(&mut buf_a) => {
                    match result {
                        Ok(Some(n)) => {
                            reader_a.push(&buf_a[..n]);
                            while let Ok(Some(frame)) = reader_a.next_frame() {
                                if !classified {
                                    if stream_kind(&frame) == StreamKind::World {
                                        // Mis-ordered: swap roles.
                                        std::mem::swap(&mut input_send, &mut world_send);
                                        // Re-send welcome on corrected world.
                                        let _ = world_send
                                            .write_all(encode_frame(&welcome).as_ref())
                                            .await;
                                    }
                                    classified = true;
                                }
                                if glitch_in.impair_inbound().await {
                                    continue;
                                }
                                if let Some(env) = client_envelope_from_frame(&frame) {
                                    games2.touch_activity(&gid);
                                    if let Some(room) = games2.room(&gid) {
                                        room.push_input(&pid, env.clone()).await;
                                        let games_dup = games2.clone();
                                        let gid_dup = gid.clone();
                                        let pid_dup = pid.clone();
                                        if glitch_in.should_repeat_inbound().await
                                            && let Some(room) = games_dup.room(&gid_dup)
                                        {
                                            room.push_input(&pid_dup, env.clone()).await;
                                        }
                                    }
                                }
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
                result = world_recv.read(&mut buf_b) => {
                    match result {
                        Ok(Some(n)) => {
                            reader_b.push(&buf_b[..n]);
                            while let Ok(Some(frame)) = reader_b.next_frame() {
                                if !classified {
                                    if stream_kind(&frame) == StreamKind::Input {
                                        std::mem::swap(&mut input_send, &mut world_send);
                                        let _ = world_send
                                            .write_all(encode_frame(&welcome).as_ref())
                                            .await;
                                    }
                                    classified = true;
                                }
                                // World uplink: Resync / Pace only.
                                if glitch_in.impair_inbound().await {
                                    continue;
                                }
                                if let Some(env) = client_envelope_from_frame(&frame) {
                                    games2.touch_activity(&gid);
                                    if let Some(room) = games2.room(&gid) {
                                        room.push_input(&pid, env.clone()).await;
                                        let games_dup = games2.clone();
                                        let gid_dup = gid.clone();
                                        let pid_dup = pid.clone();
                                        if glitch_in.should_repeat_inbound().await
                                            && let Some(room) = games_dup.room(&gid_dup)
                                        {
                                            room.push_input(&pid_dup, env.clone()).await;
                                        }
                                    }
                                }
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
                frame = input_rx.recv() => {
                    let Some(frame) = frame else { break; };
                    let bytes = encode_frame(&frame);
                    let plan = glitch_out.plan_outbound("wt-game-input").await;
                    match plan {
                        OutboundPlan::Drop => {}
                        OutboundPlan::Once | OutboundPlan::Twice => {
                            if input_send.write_all(bytes.as_ref()).await.is_err() {
                                break;
                            }
                            if plan == OutboundPlan::Twice {
                                glitch_out.duplicate_outbound_delay().await;
                                if input_send.write_all(bytes.as_ref()).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
                frame = world_rx.recv() => {
                    let Some(frame) = frame else { break; };
                    let bytes = encode_frame(&frame);
                    let plan = glitch_out.plan_outbound("wt-game-world").await;
                    match plan {
                        OutboundPlan::Drop => {}
                        OutboundPlan::Once | OutboundPlan::Twice => {
                            if world_send.write_all(bytes.as_ref()).await.is_err() {
                                break;
                            }
                            if plan == OutboundPlan::Twice {
                                glitch_out.duplicate_outbound_delay().await;
                                if world_send.write_all(bytes.as_ref()).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(room) = games.room(&game_id) {
            room.detach(&player_id, false).await;
        }
        info!(%game_id, %player_id, "WebTransport /game disconnected");
        Ok(())
    }
    .instrument(span)
    .await
}

async fn handle_relay_session(
    connection: wtransport::Connection,
    hub: Hub,
    path: &str,
    network_glitch: NetworkGlitch,
) -> anyhow::Result<()> {
    let (room, client_hint) = parse_path_query(path, hub.default_room());
    let (client_id, room, mut outbound) = hub.join(room, client_hint, TransportKind::WebTransport);

    info!(%client_id, %room, "WebTransport relay client connected");

    let conn_send = connection.clone();
    let client_id_out = client_id.clone();
    let room_out = room.clone();
    let send_client_id = client_id.clone();
    let glitch_out = network_glitch.clone();
    let send_task = tokio::spawn(async move {
        while let Some(msg) = outbound.recv().await {
            let payload = msg.payload;
            let plan = glitch_out.plan_outbound("wt-relay").await;
            match plan {
                OutboundPlan::Drop => {}
                OutboundPlan::Once | OutboundPlan::Twice => {
                    if let Err(err) = conn_send.send_datagram(payload.as_ref()) {
                        warn!(client_id = %send_client_id, error = %err, "datagram send failed");
                        break;
                    }
                    if plan == OutboundPlan::Twice {
                        glitch_out.duplicate_outbound_delay().await;
                        if conn_send.send_datagram(payload.as_ref()).is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });

    let mut buffer = vec![0u8; hub.max_payload_bytes()].into_boxed_slice();
    let glitch_in = network_glitch;

    loop {
        tokio::select! {
            result = connection.receive_datagram() => {
                match result {
                    Ok(dgram) => {
                        if glitch_in.impair_inbound().await {
                            continue;
                        }
                        let payload = Bytes::copy_from_slice(&dgram);
                        let hub_in = hub.clone();
                        let cid = client_id.clone();
                        let room_in = room.clone();
                        hub_in.broadcast(&cid, &room_in, payload.clone()).await;
                        if glitch_in.should_repeat_inbound().await {
                            hub_in.broadcast(&cid, &room_in, payload.clone()).await;
                        }
                    }
                    Err(err) => {
                        warn!(%client_id, error = %err, "datagram receive failed");
                        break;
                    }
                }
            }
            result = connection.accept_bi() => {
                match result {
                    Ok((mut send, mut recv)) => {
                        match recv.read(&mut buffer).await {
                            Ok(Some(n)) => {
                                if glitch_in.impair_inbound().await {
                                    let _ = send.write_all(b"ok").await;
                                    continue;
                                }
                                let payload = Bytes::copy_from_slice(&buffer[..n]);
                                let hub_in = hub.clone();
                                let cid = client_id.clone();
                                let room_in = room.clone();
                                hub_in.broadcast(&cid, &room_in, payload.clone()).await;
                                if glitch_in.should_repeat_inbound().await {
                                    hub_in.broadcast(&cid, &room_in, payload.clone()).await;
                                }
                                let _ = send.write_all(b"ok").await;
                            }
                            Ok(None) => {}
                            Err(err) => {
                                warn!(%client_id, error = %err, "bi stream read failed");
                                break;
                            }
                        }
                    }
                    Err(err) => {
                        warn!(%client_id, error = %err, "accept_bi failed");
                        break;
                    }
                }
            }
            result = connection.accept_uni() => {
                match result {
                    Ok(mut recv) => {
                        match recv.read(&mut buffer).await {
                            Ok(Some(n)) => {
                                if glitch_in.impair_inbound().await {
                                    continue;
                                }
                                let payload = Bytes::copy_from_slice(&buffer[..n]);
                                let hub_in = hub.clone();
                                let cid = client_id.clone();
                                let room_in = room.clone();
                                hub_in.broadcast(&cid, &room_in, payload.clone()).await;
                                if glitch_in.should_repeat_inbound().await {
                                    hub_in.broadcast(&cid, &room_in, payload.clone()).await;
                                }
                            }
                            Ok(None) => {}
                            Err(err) => {
                                warn!(%client_id, error = %err, "uni stream read failed");
                                break;
                            }
                        }
                    }
                    Err(err) => {
                        warn!(%client_id, error = %err, "accept_uni failed");
                        break;
                    }
                }
            }
        }
    }

    send_task.abort();
    hub.leave(&room_out, &client_id_out);
    info!(client_id = %client_id_out, room = %room_out, "WebTransport relay client disconnected");
    Ok(())
}

fn parse_path_query(path: &str, default_room: &str) -> (String, Option<String>) {
    let mut room = default_room.to_string();
    let mut client_id = None;

    if let Some((_, query)) = path.split_once('?') {
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                match k {
                    "room" if !v.is_empty() => room = v.to_string(),
                    "client_id" if !v.is_empty() => client_id = Some(v.to_string()),
                    _ => {}
                }
            }
        }
    }

    (room, client_id)
}

fn parse_game_query(path: &str) -> (String, String) {
    let mut game_id = String::new();
    let mut player_id = String::new();
    if let Some((_, query)) = path.split_once('?') {
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                match k {
                    "game_id" if !v.is_empty() => game_id = v.to_string(),
                    "player_id" if !v.is_empty() => player_id = v.to_string(),
                    _ => {}
                }
            }
        }
    }
    (game_id, player_id)
}
