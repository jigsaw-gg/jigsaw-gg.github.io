use crate::config::Config;
use bytes::Bytes;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

pub type ClientId = String;
pub type RoomId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportKind {
    WebTransport,
    WebRtc,
    WebSocket,
    Tcp,
    Udp,
}

impl TransportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WebTransport => "webtransport",
            Self::WebRtc => "webrtc",
            Self::WebSocket => "websocket",
            Self::Tcp => "tcp",
            Self::Udp => "udp",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RelayMessage {
    #[allow(dead_code)]
    pub from: ClientId,
    #[allow(dead_code)]
    pub room: RoomId,
    pub payload: Bytes,
}

struct ClientHandle {
    transport: TransportKind,
    tx: mpsc::Sender<RelayMessage>,
}

struct Room {
    clients: DashMap<ClientId, ClientHandle>,
}

impl Room {
    fn new() -> Self {
        Self {
            clients: DashMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct Hub {
    rooms: Arc<DashMap<RoomId, Room>>,
    default_room: RoomId,
    max_payload_bytes: usize,
}

impl Hub {
    pub fn new(config: &Config) -> Self {
        Self {
            rooms: Arc::new(DashMap::new()),
            default_room: config.default_room.clone(),
            max_payload_bytes: config.max_payload_bytes,
        }
    }

    pub fn default_room(&self) -> &str {
        &self.default_room
    }

    pub fn max_payload_bytes(&self) -> usize {
        self.max_payload_bytes
    }

    pub fn new_client_id() -> ClientId {
        Uuid::new_v4().to_string()
    }

    fn ensure_room(&self, room_id: &str) {
        if !self.rooms.contains_key(room_id) {
            self.rooms.insert(room_id.to_string(), Room::new());
        }
    }

    /// Register a client and return a receiver for outbound relay messages.
    pub fn join(
        &self,
        room_id: impl Into<String>,
        client_id: Option<String>,
        transport: TransportKind,
    ) -> (ClientId, RoomId, mpsc::Receiver<RelayMessage>) {
        let room_id = {
            let id = room_id.into();
            if id.is_empty() {
                self.default_room.clone()
            } else {
                id
            }
        };
        let client_id = client_id
            .filter(|id| !id.is_empty())
            .unwrap_or_else(Self::new_client_id);

        self.ensure_room(&room_id);
        let (tx, rx) = mpsc::channel(256);

        if let Some(room) = self.rooms.get(&room_id) {
            room.clients
                .insert(client_id.clone(), ClientHandle { transport, tx });
        }

        info!(
            client_id = %client_id,
            room = %room_id,
            transport = transport.as_str(),
            "client joined"
        );

        (client_id, room_id, rx)
    }

    pub fn leave(&self, room_id: &str, client_id: &str) {
        if let Some(room) = self.rooms.get(room_id) {
            let removed = room.clients.remove(client_id);
            if let Some((_, handle)) = removed {
                info!(
                    client_id = %client_id,
                    room = %room_id,
                    transport = handle.transport.as_str(),
                    "client left"
                );
            }
            if room.clients.is_empty() {
                drop(room);
                self.rooms.remove(room_id);
                debug!(room = %room_id, "removed empty room");
            }
        }
    }

    /// Broadcast payload to every peer in the room except the sender.
    pub async fn broadcast(&self, from: &str, room: &str, payload: Bytes) {
        if payload.len() > self.max_payload_bytes {
            warn!(
                from = %from,
                size = payload.len(),
                max = self.max_payload_bytes,
                "dropping oversized payload"
            );
            return;
        }

        let Some(room_handle) = self.rooms.get(room) else {
            return;
        };

        let message = RelayMessage {
            from: from.to_string(),
            room: room.to_string(),
            payload,
        };

        let mut dead: Vec<ClientId> = Vec::new();
        for entry in room_handle.clients.iter() {
            let peer_id = entry.key();
            if peer_id == from {
                continue;
            }
            if entry.tx.try_send(message.clone()).is_err() {
                dead.push(peer_id.clone());
            }
        }
        drop(room_handle);

        for peer in dead {
            warn!(client_id = %peer, room = %room, "removing unresponsive peer");
            self.leave(room, &peer);
        }
    }
}
