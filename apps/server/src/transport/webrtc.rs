//! WebRTC DataChannel transport pipe.
//!
//! Like WebSocket / WebTransport, this is an opaque byte pipe into the hub.
//! SDP/ICE setup is transport plumbing — not an application RPC — so it is
//! no longer exposed via `relay.v1` (Ping only). Wire a non-proto setup path
//! when browser WebRTC bring-up is needed again.
#![allow(dead_code)]

use crate::hub::{Hub, TransportKind};
use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use bytes::{Bytes, BytesMut};
use dashmap::DashMap;
use std::sync::Arc;
use tracing::{info, warn};
use webrtc::data_channel::{DataChannel, DataChannelEvent, RTCDataChannelInit};
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
    RTCIceCandidateInit, RTCIceGatheringState, RTCIceServer, RTCPeerConnectionIceEvent,
    RTCPeerConnectionState, RTCSessionDescription,
};
use webrtc::runtime::{Receiver, Runtime, Sender, channel, default_runtime};

#[derive(Clone)]
pub struct WebRtcManager {
    hub: Hub,
    runtime: Arc<dyn Runtime>,
    sessions: Arc<DashMap<String, Session>>,
    udp_addr: String,
}

struct Session {
    pc: Arc<dyn PeerConnection>,
    client_id: String,
    room: String,
}

struct Handler {
    client_id: String,
    room: String,
    hub: Hub,
    ice_tx: Sender<RTCIceCandidateInit>,
    gather_tx: Sender<()>,
    runtime: Arc<dyn Runtime>,
}

#[async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Ok(init) = event.candidate.to_json() {
            let _ = self.ice_tx.try_send(init);
        }
    }

    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            let _ = self.gather_tx.try_send(());
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        info!(
            client_id = %self.client_id,
            room = %self.room,
            %state,
            "WebRTC connection state"
        );
        if matches!(
            state,
            RTCPeerConnectionState::Failed
                | RTCPeerConnectionState::Closed
                | RTCPeerConnectionState::Disconnected
        ) {
            self.hub.leave(&self.room, &self.client_id);
        }
    }

    async fn on_data_channel(&self, dc: Arc<dyn DataChannel>) {
        let hub = self.hub.clone();
        let client_id = self.client_id.clone();
        let room = self.room.clone();
        let runtime = self.runtime.clone();

        let (joined_id, joined_room, mut outbound) =
            hub.join(room, Some(client_id), TransportKind::WebRtc);

        let dc_send = dc.clone();
        let send_id = joined_id.clone();
        runtime.spawn(Box::pin(async move {
            while let Some(msg) = outbound.recv().await {
                let data = BytesMut::from(msg.payload.as_ref());
                if let Err(err) = dc_send.send(data).await {
                    warn!(client_id = %send_id, error = %err, "DataChannel send failed");
                    break;
                }
            }
        }));

        let hub_recv = hub;
        let client_recv = joined_id;
        let room_recv = joined_room;
        runtime.spawn(Box::pin(async move {
            while let Some(event) = dc.poll().await {
                match event {
                    DataChannelEvent::OnOpen => {
                        info!(client_id = %client_recv, "DataChannel open");
                    }
                    DataChannelEvent::OnMessage(msg) => {
                        hub_recv
                            .broadcast(&client_recv, &room_recv, Bytes::copy_from_slice(&msg.data))
                            .await;
                    }
                    DataChannelEvent::OnClose => {
                        info!(client_id = %client_recv, "DataChannel closed");
                        hub_recv.leave(&room_recv, &client_recv);
                        break;
                    }
                    _ => {}
                }
            }
        }));
    }
}

pub struct AnswerBundle {
    pub client_id: String,
    pub room: String,
    pub answer: RTCSessionDescription,
    pub ice_rx: Receiver<RTCIceCandidateInit>,
}

impl WebRtcManager {
    pub fn new(hub: Hub, udp_addr: std::net::SocketAddr) -> Self {
        let runtime = default_runtime().expect("webrtc tokio runtime feature enabled");
        Self {
            hub,
            runtime,
            sessions: Arc::new(DashMap::new()),
            udp_addr: udp_addr.to_string(),
        }
    }

    pub async fn answer_offer(
        &self,
        room: String,
        client_id: Option<String>,
        sdp: String,
        unreliable: bool,
    ) -> Result<AnswerBundle> {
        let client_id = client_id
            .filter(|id| !id.is_empty())
            .unwrap_or_else(Hub::new_client_id);
        let room = if room.is_empty() {
            self.hub.default_room().to_string()
        } else {
            room
        };

        let offer = RTCSessionDescription::offer(sdp).context("parse offer SDP")?;
        let (ice_tx, ice_rx) = channel::<RTCIceCandidateInit>(64);
        let (gather_tx, mut gather_rx) = channel::<()>(1);

        let handler = Arc::new(Handler {
            client_id: client_id.clone(),
            room: room.clone(),
            hub: self.hub.clone(),
            ice_tx,
            gather_tx,
            runtime: self.runtime.clone(),
        });

        let config = RTCConfigurationBuilder::new()
            .with_ice_servers(vec![RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_string()],
                ..Default::default()
            }])
            .build();

        let pc = PeerConnectionBuilder::new()
            .with_configuration(config)
            .with_handler(handler)
            .with_runtime(self.runtime.clone())
            .with_udp_addrs(vec![self.udp_addr.clone()])
            .build()
            .await
            .context("build peer connection")?;

        // Prefer browser-created channels. Optionally open an unordered channel too.
        if unreliable {
            let init = RTCDataChannelInit {
                ordered: false,
                max_retransmits: Some(0),
                ..Default::default()
            };
            let _ = pc.create_data_channel("relay-udp", Some(init)).await;
        }

        pc.set_remote_description(offer)
            .await
            .context("set remote description")?;
        let answer = pc.create_answer(None).await.context("create answer")?;
        pc.set_local_description(answer)
            .await
            .context("set local description")?;

        let _ = webrtc::runtime::timeout(
            &*self.runtime,
            std::time::Duration::from_secs(2),
            gather_rx.recv(),
        )
        .await;

        let local = pc
            .local_description()
            .await
            .ok_or_else(|| anyhow!("missing local description"))?;

        let pc: Arc<dyn PeerConnection> = Arc::new(pc);
        self.sessions.insert(
            client_id.clone(),
            Session {
                pc,
                client_id: client_id.clone(),
                room: room.clone(),
            },
        );

        Ok(AnswerBundle {
            client_id,
            room,
            answer: local,
            ice_rx,
        })
    }

    pub async fn add_ice_candidate(
        &self,
        client_id: &str,
        candidate: RTCIceCandidateInit,
    ) -> Result<()> {
        let Some(session) = self.sessions.get(client_id) else {
            anyhow::bail!("unknown WebRTC session {client_id}");
        };
        session
            .pc
            .add_ice_candidate(candidate)
            .await
            .context("add ICE candidate")?;
        Ok(())
    }

    pub async fn close(&self, client_id: &str) {
        if let Some((_, session)) = self.sessions.remove(client_id) {
            let _ = session.pc.close().await;
            self.hub.leave(&session.room, &session.client_id);
        }
    }
}
