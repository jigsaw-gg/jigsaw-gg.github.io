use crate::hub::{Hub, TransportKind};
use anyhow::Context;
use bytes::Bytes;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{info, warn};

/// Frame format: `u32` big-endian length + payload bytes.
pub async fn serve(addr: SocketAddr, hub: Hub) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr).await.context("bind TCP")?;
    info!(%addr, "raw TCP relay listening (length-prefixed frames)");

    loop {
        let (stream, peer) = listener.accept().await?;
        let hub = hub.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_client(stream, peer, hub).await {
                warn!(%peer, error = %err, "TCP client error");
            }
        });
    }
}

async fn handle_client(mut stream: TcpStream, peer: SocketAddr, hub: Hub) -> anyhow::Result<()> {
    // Optional first-frame text join: "JOIN <room> [client_id]"
    // If the first frame is not a JOIN, treat it as a normal payload in the default room.
    let first = read_frame(&mut stream).await?;
    let (client_id, room, mut outbound, first_payload) =
        if let Some((room, client_hint)) = parse_join(&first) {
            let (client_id, room, outbound) = hub.join(room, client_hint, TransportKind::Tcp);
            (client_id, room, outbound, None)
        } else {
            let (client_id, room, outbound) =
                hub.join(hub.default_room().to_string(), None, TransportKind::Tcp);
            (client_id, room, outbound, Some(first))
        };

    info!(%client_id, %room, %peer, "TCP client connected");

    let client_id_out = client_id.clone();
    let (mut reader, mut writer) = stream.into_split();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = outbound.recv().await {
            if write_frame(&mut writer, &msg.payload).await.is_err() {
                break;
            }
        }
    });

    if let Some(payload) = first_payload {
        hub.broadcast(&client_id, &room, payload).await;
    }

    loop {
        match read_frame(&mut reader).await {
            Ok(payload) => hub.broadcast(&client_id, &room, payload).await,
            Err(err) => {
                warn!(%client_id, error = %err, "TCP read ended");
                break;
            }
        }
    }

    send_task.abort();
    hub.leave(&room, &client_id_out);
    info!(client_id = %client_id_out, %room, "TCP client disconnected");
    Ok(())
}

async fn read_frame<R: AsyncReadExt + Unpin>(reader: &mut R) -> anyhow::Result<Bytes> {
    let len = reader.read_u32().await.context("read frame length")? as usize;
    if len > 16 * 1024 * 1024 {
        anyhow::bail!("frame too large: {len}");
    }
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .await
        .context("read frame body")?;
    Ok(Bytes::from(buf))
}

async fn write_frame<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    payload: &[u8],
) -> anyhow::Result<()> {
    writer
        .write_u32(payload.len() as u32)
        .await
        .context("write frame length")?;
    writer
        .write_all(payload)
        .await
        .context("write frame body")?;
    writer.flush().await?;
    Ok(())
}

fn parse_join(payload: &Bytes) -> Option<(String, Option<String>)> {
    let text = std::str::from_utf8(payload).ok()?.trim();
    let mut parts = text.split_whitespace();
    if parts.next()?.eq_ignore_ascii_case("JOIN") {
        let room = parts.next()?.to_string();
        let client_id = parts.next().map(str::to_string);
        Some((room, client_id))
    } else {
        None
    }
}
