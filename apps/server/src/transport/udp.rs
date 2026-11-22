use crate::hub::{Hub, TransportKind};
use crate::netsim::NetSim;
use anyhow::Context;
use bytes::Bytes;
use dashmap::DashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tracing::{debug, info, warn};

struct UdpPeer {
    client_id: String,
    room: String,
}

/// Each UDP datagram is one arbitrary payload.
/// Clients are keyed by socket address. Optional first packet:
/// `JOIN <room> [client_id]` (UTF-8 text) registers metadata; otherwise default room is used.
///
/// When [`NetSim`] is enabled, data datagrams (not JOIN) are delayed / dropped /
/// duplicated on both inbound and outbound paths.
pub async fn serve(addr: SocketAddr, hub: Hub, net_sim: NetSim) -> anyhow::Result<()> {
    let socket = Arc::new(UdpSocket::bind(addr).await.context("bind UDP")?);
    info!(%addr, "raw UDP relay listening");

    let peers: Arc<DashMap<SocketAddr, UdpPeer>> = Arc::new(DashMap::new());
    let mut buf = vec![0u8; hub.max_payload_bytes()];

    loop {
        let (n, peer_addr) = socket.recv_from(&mut buf).await?;
        let payload = Bytes::copy_from_slice(&buf[..n]);

        if let Some(join) = parse_join(&payload) {
            register_peer(
                &hub,
                &peers,
                &socket,
                peer_addr,
                join.0,
                join.1,
                net_sim.clone(),
            )
            .await;
            continue;
        }

        if !peers.contains_key(&peer_addr) {
            register_peer(
                &hub,
                &peers,
                &socket,
                peer_addr,
                hub.default_room().to_string(),
                None,
                net_sim.clone(),
            )
            .await;
        }

        let Some(peer) = peers
            .get(&peer_addr)
            .map(|p| (p.client_id.clone(), p.room.clone()))
        else {
            continue;
        };

        if net_sim.enabled() {
            let hub = hub.clone();
            let net_sim = net_sim.clone();
            tokio::spawn(async move {
                deliver_inbound(&hub, &net_sim, &peer.0, &peer.1, payload).await;
            });
        } else {
            hub.broadcast(&peer.0, &peer.1, payload).await;
        }
    }
}

async fn deliver_inbound(hub: &Hub, net_sim: &NetSim, client_id: &str, room: &str, payload: Bytes) {
    if net_sim.should_drop() {
        debug!(%client_id, %room, "UDP inbound drop (netsim)");
        return;
    }

    net_sim.apply_delay().await;
    hub.broadcast(client_id, room, payload.clone()).await;

    if net_sim.should_duplicate() {
        debug!(%client_id, %room, "UDP inbound duplicate (netsim)");
        hub.broadcast(client_id, room, payload).await;
    }
}

async fn register_peer(
    hub: &Hub,
    peers: &Arc<DashMap<SocketAddr, UdpPeer>>,
    socket: &Arc<UdpSocket>,
    peer_addr: SocketAddr,
    room: String,
    client_hint: Option<String>,
    net_sim: NetSim,
) {
    if let Some((_, old)) = peers.remove(&peer_addr) {
        hub.leave(&old.room, &old.client_id);
    }

    let (client_id, room, mut outbound) = hub.join(room, client_hint, TransportKind::Udp);

    let socket = Arc::clone(socket);
    let client_id_log = client_id.clone();
    tokio::spawn(async move {
        while let Some(msg) = outbound.recv().await {
            if net_sim.enabled() {
                let socket = Arc::clone(&socket);
                let net_sim = net_sim.clone();
                let client_id_log = client_id_log.clone();
                let payload = msg.payload;
                tokio::spawn(async move {
                    send_outbound(&socket, &net_sim, peer_addr, &client_id_log, payload).await;
                });
            } else if let Err(err) = socket.send_to(msg.payload.as_ref(), peer_addr).await {
                warn!(client_id = %client_id_log, %peer_addr, error = %err, "UDP send failed");
                break;
            }
        }
    });

    info!(%client_id, %room, %peer_addr, "UDP client registered");
    peers.insert(peer_addr, UdpPeer { client_id, room });
    debug!(%peer_addr, "udp peer map size={}", peers.len());
}

async fn send_outbound(
    socket: &UdpSocket,
    net_sim: &NetSim,
    peer_addr: SocketAddr,
    client_id: &str,
    payload: Bytes,
) {
    if net_sim.should_drop() {
        debug!(%client_id, %peer_addr, "UDP outbound drop (netsim)");
        return;
    }

    net_sim.apply_delay().await;

    if let Err(err) = socket.send_to(payload.as_ref(), peer_addr).await {
        warn!(%client_id, %peer_addr, error = %err, "UDP send failed");
        return;
    }

    if net_sim.should_duplicate() {
        debug!(%client_id, %peer_addr, "UDP outbound duplicate (netsim)");
        if let Err(err) = socket.send_to(payload.as_ref(), peer_addr).await {
            warn!(%client_id, %peer_addr, error = %err, "UDP dup send failed");
        }
    }
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
