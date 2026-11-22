//! Live room: shared board + holdings + per-player streams + 10 Hz sim.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{Mutex, mpsc, oneshot};
use tracing::{debug, info, warn};

use crate::game::constants::{
    EMPTY_ROOM_GRACE, HEARTBEAT_TIMEOUT, HEARTBEAT_TIMEOUT_MS, MOTION_Q, RESYNC_EVERY_TICKS,
    SNAP_FRACTION, TICK_HZ, TICK_INTERVAL,
};
use crate::game::grid::initial_board;
use crate::game::motion::Trajectory;
use crate::game::rotation::{rotate_members, turn_offset};
use crate::otel;
use crate::proto::game::v1::{
    BoardSnapshot, ClaimResult, ClientEnvelope, GameEvent, HeartbeatAck, HeldGroup, MergeResult,
    MotionSample, PieceState, PlayerInfo, PlayerPose, PresenceUpdate, PuzzleSetup, ServerEnvelope,
    StreamFrame, StreamKind, Tick, TransportKind, Welcome, client_envelope, game_event,
    server_envelope,
};

#[derive(Debug, Clone)]
pub struct PlayerOut {
    pub input_tx: mpsc::Sender<StreamFrame>,
    pub world_tx: mpsc::Sender<StreamFrame>,
    pub dual_bidi: bool,
    pub transport: TransportKind,
}

struct Hold {
    player_id: String,
    anchor_piece_index: u32,
    group_id: u32,
    members: Vec<u32>,
}

struct PlayerRuntime {
    display_name: String,
    online: bool,
    last_seen: Instant,
    last_seq: u64,
    cursor: Trajectory,
    held: Trajectory,
    out: Option<PlayerOut>,
    wants_resync: bool,
}

pub struct RoomState {
    pub game_id: String,
    setup: PuzzleSetup,
    cols: u32,
    #[allow(dead_code)]
    rows: u32,
    cell_w: f32,
    cell_h: f32,
    pub board: BoardSnapshot,
    holdings: HashMap<u32, Hold>,
    players: HashMap<String, PlayerRuntime>,
    tick_id: u64,
    server_seq: u64,
    empty_since: Option<Instant>,
    session_started_at: Instant,
}

impl RoomState {
    pub fn new(game_id: String, setup: PuzzleSetup, cols: u32, rows: u32) -> Self {
        let cell_w = setup.image_width as f32 / cols.max(1) as f32;
        let cell_h = setup.image_height as f32 / rows.max(1) as f32;
        let board = initial_board(&setup, cols, rows);
        Self {
            game_id,
            setup,
            cols,
            rows,
            cell_w,
            cell_h,
            board,
            holdings: HashMap::new(),
            players: HashMap::new(),
            tick_id: 0,
            server_seq: 0,
            empty_since: None,
            session_started_at: Instant::now(),
        }
    }

    fn session_elapsed_ms(&self) -> i64 {
        self.session_started_at.elapsed().as_millis() as i64
    }

    pub fn snapshot_players(&self) -> Vec<PlayerInfo> {
        let mut list: Vec<_> = self
            .players
            .iter()
            .map(|(id, p)| PlayerInfo {
                player_id: id.clone(),
                display_name: p.display_name.clone(),
                online: p.online && p.out.is_some(),
            })
            .collect();
        list.sort_by(|a, b| a.player_id.cmp(&b.player_id));
        list
    }

    pub fn holdings_proto(&self) -> Vec<HeldGroup> {
        self.holdings
            .values()
            .map(|h| HeldGroup {
                player_id: h.player_id.clone(),
                anchor_piece_index: h.anchor_piece_index,
                group_id: h.group_id,
                member_piece_indices: h.members.clone(),
                rotation: self
                    .board
                    .pieces
                    .iter()
                    .find(|p| p.group_id == h.group_id)
                    .map_or(0, |p| p.rotation),
            })
            .collect()
    }

    fn next_seq(&mut self) -> u64 {
        self.server_seq = self.server_seq.wrapping_add(1);
        self.server_seq
    }

    fn server_envelope(&mut self, body: server_envelope::Body) -> ServerEnvelope {
        let session_elapsed_ms = self.session_elapsed_ms();
        otel::touch_game_session_clock(&self.game_id, session_elapsed_ms);
        ServerEnvelope {
            game_id: self.game_id.clone(),
            seq: self.next_seq(),
            server_time_ms: now_ms(),
            session_elapsed_ms,
            body: Some(body),
        }
    }

    fn piece_mut(&mut self, index: u32) -> Option<&mut PieceState> {
        self.board
            .pieces
            .iter_mut()
            .find(|p| p.piece_index == index)
    }

    fn piece(&self, index: u32) -> Option<&PieceState> {
        self.board.pieces.iter().find(|p| p.piece_index == index)
    }

    fn group_members(&self, group_id: u32) -> Vec<u32> {
        self.board
            .pieces
            .iter()
            .filter(|p| p.group_id == group_id)
            .map(|p| p.piece_index)
            .collect()
    }

    fn holder_of_piece(&self, piece_index: u32) -> Option<&str> {
        let group = self.piece(piece_index)?.group_id;
        self.holdings.get(&group).map(|h| h.player_id.as_str())
    }

    fn bump_board_rev(&mut self) {
        self.board.board_rev = self.board.board_rev.wrapping_add(1);
    }
}

pub enum RoomCommand {
    /// Register a player from JoinGame before play streams connect.
    Register {
        player_id: String,
        display_name: String,
        reply: oneshot::Sender<()>,
    },
    Attach {
        player_id: String,
        display_name: String,
        out: PlayerOut,
        reply: oneshot::Sender<AttachResult>,
    },
    Detach {
        player_id: String,
        explicit_leave: bool,
    },
    ClientInput {
        player_id: String,
        envelope: ClientEnvelope,
    },
}

pub struct AttachResult {
    pub welcome: StreamFrame,
    pub board: BoardSnapshot,
    pub players: Vec<PlayerInfo>,
}

pub struct RoomHandle {
    pub state: Arc<Mutex<RoomState>>,
    cmd_tx: mpsc::Sender<RoomCommand>,
}

impl RoomHandle {
    pub fn spawn(game_id: String, setup: PuzzleSetup, cols: u32, rows: u32) -> Arc<Self> {
        let state = Arc::new(Mutex::new(RoomState::new(
            game_id.clone(),
            setup,
            cols,
            rows,
        )));
        let (cmd_tx, cmd_rx) = mpsc::channel(512);
        let handle = Arc::new(Self {
            state: state.clone(),
            cmd_tx,
        });
        tokio::spawn(async move {
            run_sim(game_id, state, cmd_rx).await;
        });
        handle
    }

    pub async fn register_player(
        &self,
        player_id: String,
        display_name: String,
    ) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(RoomCommand::Register {
                player_id,
                display_name,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "room closed".to_string())?;
        reply_rx.await.map_err(|_| "room closed".to_string())
    }

    pub async fn attach(
        &self,
        player_id: String,
        display_name: String,
        out: PlayerOut,
    ) -> Result<AttachResult, String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(RoomCommand::Attach {
                player_id,
                display_name,
                out,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "room closed".to_string())?;
        reply_rx.await.map_err(|_| "room closed".to_string())
    }

    pub async fn detach(&self, player_id: &str, explicit_leave: bool) {
        let _ = self
            .cmd_tx
            .send(RoomCommand::Detach {
                player_id: player_id.to_string(),
                explicit_leave,
            })
            .await;
    }

    pub async fn push_input(&self, player_id: &str, envelope: ClientEnvelope) {
        let _ = self
            .cmd_tx
            .send(RoomCommand::ClientInput {
                player_id: player_id.to_string(),
                envelope,
            })
            .await;
    }

    pub async fn board_snapshot(&self) -> BoardSnapshot {
        self.state.lock().await.board.clone()
    }

    pub async fn player_infos(&self) -> Vec<PlayerInfo> {
        self.state.lock().await.snapshot_players()
    }

    pub async fn should_destroy(&self) -> bool {
        let st = self.state.lock().await;
        match st.empty_since {
            Some(since) => since.elapsed() >= EMPTY_ROOM_GRACE,
            None => false,
        }
    }
}

async fn run_sim(
    game_id: String,
    state: Arc<Mutex<RoomState>>,
    mut cmd_rx: mpsc::Receiver<RoomCommand>,
) {
    info!(%game_id, "room sim started");
    let mut ticker = tokio::time::interval(TICK_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                let Some(cmd) = cmd else { break; };
                let mut st = state.lock().await;
                handle_command(&mut st, cmd);
            }
            _ = ticker.tick() => {
                let mut st = state.lock().await;
                tick_once(&mut st);
            }
        }
    }
    otel::clear_game_session_clock(&game_id);
    info!(%game_id, "room sim stopped");
}

fn handle_command(st: &mut RoomState, cmd: RoomCommand) {
    match cmd {
        RoomCommand::Register {
            player_id,
            display_name,
            reply,
        } => {
            st.empty_since = None;
            let entry = st
                .players
                .entry(player_id.clone())
                .or_insert_with(|| PlayerRuntime {
                    display_name: display_name.clone(),
                    online: false,
                    last_seen: Instant::now(),
                    last_seq: 0,
                    cursor: Trajectory::default(),
                    held: Trajectory::default(),
                    out: None,
                    wants_resync: true,
                });
            if !display_name.is_empty() {
                entry.display_name = display_name;
            }
            // Reconnecting same player_id replaces presence; holdings kept until timeout/leave.
            let presence = build_presence_frame(st, Vec::new());
            broadcast_world(st, presence);
            let _ = reply.send(());
        }
        RoomCommand::Attach {
            player_id,
            display_name,
            out,
            reply,
        } => {
            st.empty_since = None;
            let dual = out.dual_bidi;
            let transport = out.transport;
            let entry = st
                .players
                .entry(player_id.clone())
                .or_insert_with(|| PlayerRuntime {
                    display_name: display_name.clone(),
                    online: true,
                    last_seen: Instant::now(),
                    last_seq: 0,
                    cursor: Trajectory::default(),
                    held: Trajectory::default(),
                    out: None,
                    wants_resync: true,
                });
            if !display_name.is_empty() {
                entry.display_name = display_name;
            }
            entry.online = true;
            entry.last_seen = Instant::now();
            entry.out = Some(out);
            entry.wants_resync = true;

            let welcome_body = st.server_envelope(server_envelope::Body::Welcome(Welcome {
                player_id: player_id.clone(),
                board: Some(st.board.clone()),
                players: st.snapshot_players(),
                holdings: st.holdings_proto(),
                tick_hz: TICK_HZ,
                heartbeat_timeout_ms: HEARTBEAT_TIMEOUT_MS,
                dual_bidi_streams: dual,
                transport: transport as i32,
            }));
            let welcome = StreamFrame {
                stream: StreamKind::World as i32,
                seq: welcome_body.seq,
                time_ms: welcome_body.server_time_ms,
                body: Some(crate::proto::game::v1::stream_frame::Body::Server(
                    welcome_body,
                )),
            };

            let presence = build_presence_frame(st, Vec::new());
            broadcast_world(st, presence);

            let _ = reply.send(AttachResult {
                welcome,
                board: st.board.clone(),
                players: st.snapshot_players(),
            });
        }
        RoomCommand::Detach {
            player_id,
            explicit_leave,
        } => {
            force_release_player(st, &player_id, "disconnect");
            if let Some(p) = st.players.get_mut(&player_id) {
                p.out = None;
                p.online = false;
                if explicit_leave {
                    // Keep roster entry briefly offline; presence notifies removal.
                }
            }
            let removed = if explicit_leave {
                st.players.remove(&player_id);
                vec![player_id.clone()]
            } else {
                Vec::new()
            };
            let presence = build_presence_frame(st, removed);
            broadcast_world(st, presence);
            if st.players.values().all(|p| !p.online || p.out.is_none()) {
                st.empty_since = Some(Instant::now());
            }
        }
        RoomCommand::ClientInput {
            player_id,
            envelope,
        } => {
            apply_client_input(st, &player_id, envelope);
        }
    }
}

fn apply_client_input(st: &mut RoomState, player_id: &str, envelope: ClientEnvelope) {
    let _guard = otel::input_span("client_envelope").entered();
    otel::record_game_id(&st.game_id);
    otel::record_player_id(player_id);

    let Some(player) = st.players.get_mut(player_id) else {
        return;
    };
    if envelope.seq != 0 && envelope.seq <= player.last_seq {
        debug!(%player_id, seq = envelope.seq, "drop old/dup seq");
        return;
    }
    if envelope.seq != 0 {
        player.last_seq = envelope.seq;
    }
    player.last_seen = Instant::now();
    player.online = true;

    let body = match envelope.body {
        Some(b) => b,
        None => return,
    };

    match body {
        client_envelope::Body::Heartbeat(hb) => {
            let ack = st.server_envelope(server_envelope::Body::HeartbeatAck(HeartbeatAck {
                nonce: hb.nonce,
                server_time_ms: now_ms(),
            }));
            send_input_to(st, player_id, ack);
        }
        client_envelope::Body::Cursor(cursor) => {
            if let Some(sample) = cursor.motion {
                let now = now_ms() as f64;
                if let Some(p) = st.players.get_mut(player_id) {
                    p.cursor.push_sample(&sample, now);
                }
            }
        }
        client_envelope::Body::Claim(claim) => {
            handle_claim(st, player_id, claim);
        }
        client_envelope::Body::Release(release) => {
            handle_release(st, player_id, release);
        }
        client_envelope::Body::MoveHeld(mv) => {
            handle_move_held(st, player_id, mv);
        }
        client_envelope::Body::Merge(merge) => {
            handle_merge(st, player_id, merge);
        }
        client_envelope::Body::Rename(rename) => {
            if let Some(p) = st.players.get_mut(player_id) {
                p.display_name = rename.display_name;
            }
            let presence = build_presence_frame(st, Vec::new());
            broadcast_world(st, presence);
        }
        client_envelope::Body::Resync(_) => {
            if let Some(p) = st.players.get_mut(player_id) {
                p.wants_resync = true;
            }
        }
        client_envelope::Body::Pace(_) => {
            // Backpressure hint — honored by coalescing; nothing else for v1.
        }
        client_envelope::Body::Rotate(rotate) => {
            handle_rotate(st, player_id, rotate);
        }
    }
}

fn handle_claim(st: &mut RoomState, player_id: &str, claim: crate::proto::game::v1::ClaimControl) {
    let _guard = otel::piece_logic_span("claim").entered();
    otel::record_game_id(&st.game_id);
    otel::record_player_id(player_id);
    let mut granted = Vec::new();
    let mut denied = Vec::new();
    let mut holder = String::new();

    // Expand to unique group memberships for requested pieces.
    let mut groups: HashSet<u32> = HashSet::new();
    for idx in &claim.piece_indices {
        if let Some(p) = st.piece(*idx) {
            groups.insert(p.group_id);
        } else {
            denied.push(*idx);
        }
    }

    for group_id in groups {
        let members = st.group_members(group_id);
        let contested = members.iter().find_map(|m| {
            let h = st.holder_of_piece(*m)?;
            if h != player_id {
                Some(h.to_string())
            } else {
                None
            }
        });
        if let Some(other) = contested {
            denied.extend(members);
            if holder.is_empty() {
                holder = other;
            }
        } else {
            granted.extend(members.iter().copied());
            let anchor = if members.contains(&claim.anchor_piece_index) {
                claim.anchor_piece_index
            } else {
                *members.first().unwrap_or(&group_id)
            };
            st.holdings.insert(
                group_id,
                Hold {
                    player_id: player_id.to_string(),
                    anchor_piece_index: anchor,
                    group_id,
                    members: members.clone(),
                },
            );
        }
    }

    let accepted = !granted.is_empty();
    let result = st.server_envelope(server_envelope::Body::ClaimResult(ClaimResult {
        client_claim_id: claim.client_claim_id,
        accepted,
        granted_piece_indices: granted,
        denied_piece_indices: denied,
        holder_player_id: holder,
    }));
    send_input_to(st, player_id, result);
}

fn handle_release(
    st: &mut RoomState,
    player_id: &str,
    release: crate::proto::game::v1::ReleaseControl,
) {
    let _guard = otel::piece_logic_span("release").entered();
    otel::record_game_id(&st.game_id);
    otel::record_player_id(player_id);
    for pose in &release.final_poses {
        if st.holder_of_piece(pose.piece_index) != Some(player_id) {
            continue;
        }
        if let Some(piece) = st.piece_mut(pose.piece_index) {
            piece.x_q = pose.x_q;
            piece.y_q = pose.y_q;
            piece.rev = piece.rev.wrapping_add(1);
        }
    }
    st.bump_board_rev();

    let targets: HashSet<u32> = if release.piece_indices.is_empty() {
        st.holdings
            .iter()
            .filter(|(_, h)| h.player_id == player_id)
            .map(|(g, _)| *g)
            .collect()
    } else {
        release
            .piece_indices
            .iter()
            .filter_map(|idx| st.piece(*idx).map(|p| p.group_id))
            .collect()
    };

    for g in targets {
        if let Some(h) = st.holdings.get(&g)
            && h.player_id == player_id
        {
            st.holdings.remove(&g);
        }
    }

    if let Some(p) = st.players.get_mut(player_id) {
        p.held = Trajectory::default();
    }
}

fn handle_move_held(st: &mut RoomState, player_id: &str, mv: crate::proto::game::v1::MoveHeld) {
    let _guard = otel::piece_logic_span("move_held").entered();
    otel::record_game_id(&st.game_id);
    otel::record_player_id(player_id);
    let holds_ok = st.holdings.values().any(|h| {
        h.player_id == player_id
            && (h.group_id == mv.group_id || h.anchor_piece_index == mv.anchor_piece_index)
    });
    if !holds_ok {
        return;
    }
    if let Some(sample) = mv.motion {
        let now = now_ms() as f64;
        if let Some(p) = st.players.get_mut(player_id) {
            p.held.push_sample(&sample, now);
        }
        // Refresh member list / anchor if provided.
        if let Some(h) = st.holdings.get_mut(&mv.group_id)
            && h.player_id == player_id
        {
            h.anchor_piece_index = mv.anchor_piece_index;
            if !mv.member_piece_indices.is_empty() {
                h.members = mv.member_piece_indices;
            }
        }
    }
}

fn handle_rotate(st: &mut RoomState, player_id: &str, rotate: crate::proto::game::v1::RotateHeld) {
    let _guard = otel::piece_logic_span("rotate").entered();
    otel::record_game_id(&st.game_id);
    otel::record_player_id(player_id);
    let turns = rotate.quarter_turns % 4;
    if !st.setup.rotation_enabled || turns == 0 {
        return;
    }
    let held_group = |group_id: u32| {
        st.holdings
            .get(&group_id)
            .filter(|h| h.player_id == player_id)
            .map(|h| h.anchor_piece_index)
    };
    let target = match st.piece(rotate.anchor_piece_index).map(|p| p.group_id) {
        Some(group_id) if held_group(group_id).is_some() => {
            Some((group_id, rotate.anchor_piece_index))
        }
        _ => held_group(rotate.group_id).map(|anchor| (rotate.group_id, anchor)),
    };
    let Some((group_id, pivot)) = target else {
        return;
    };
    let members = st.group_members(group_id);
    if !members.contains(&pivot) || !rotate_members(&mut st.board.pieces, &members, pivot, turns) {
        return;
    }
    st.bump_board_rev();
    if let Some(h) = st.holdings.get_mut(&group_id) {
        h.anchor_piece_index = pivot;
    }
}

fn handle_merge(st: &mut RoomState, player_id: &str, merge: crate::proto::game::v1::MergeGroups) {
    let _guard = otel::piece_logic_span("merge").entered();
    otel::record_game_id(&st.game_id);
    otel::record_player_id(player_id);
    let moving_hold = st.holdings.get(&merge.moving_group_id);
    if moving_hold.map(|h| h.player_id.as_str()) != Some(player_id) {
        let result = st.server_envelope(server_envelope::Body::MergeResult(MergeResult {
            client_merge_id: merge.client_merge_id,
            accepted: false,
            resulting_group_id: 0,
            member_piece_indices: vec![],
            board: None,
            reject_reason: "must hold moving group".into(),
        }));
        send_input_to(st, player_id, result);
        return;
    }

    if let Some(th) = st.holdings.get(&merge.target_group_id)
        && th.player_id != player_id
    {
        let result = st.server_envelope(server_envelope::Body::MergeResult(MergeResult {
            client_merge_id: merge.client_merge_id,
            accepted: false,
            resulting_group_id: 0,
            member_piece_indices: vec![],
            board: None,
            reject_reason: "target held by another player".into(),
        }));
        send_input_to(st, player_id, result);
        return;
    }

    let moving_members = if merge.moving_member_indices.is_empty() {
        st.group_members(merge.moving_group_id)
    } else {
        merge.moving_member_indices.clone()
    };
    let target_members = if merge.target_member_indices.is_empty() {
        st.group_members(merge.target_group_id)
    } else {
        merge.target_member_indices.clone()
    };

    if moving_members.is_empty() || target_members.is_empty() {
        let result = st.server_envelope(server_envelope::Body::MergeResult(MergeResult {
            client_merge_id: merge.client_merge_id,
            accepted: false,
            resulting_group_id: 0,
            member_piece_indices: vec![],
            board: None,
            reject_reason: "unknown groups".into(),
        }));
        send_input_to(st, player_id, result);
        return;
    }

    // The member lists come from the client, so the board's members count too.
    let mut rotations = moving_members
        .iter()
        .chain(&target_members)
        .copied()
        .chain(st.group_members(merge.moving_group_id))
        .chain(st.group_members(merge.target_group_id))
        .filter_map(|idx| st.piece(idx).map(|p| p.rotation));
    let rotation = rotations.next().unwrap_or(0);
    if rotations.any(|r| r != rotation) {
        let result = st.server_envelope(server_envelope::Body::MergeResult(MergeResult {
            client_merge_id: merge.client_merge_id,
            accepted: false,
            resulting_group_id: 0,
            member_piece_indices: vec![],
            board: None,
            reject_reason: "rotation mismatch".into(),
        }));
        send_input_to(st, player_id, result);
        return;
    }

    // The client sends the pose of the piece it drags, which is the hold's anchor.
    let anchor_index = st
        .holdings
        .get(&merge.moving_group_id)
        .map(|h| h.anchor_piece_index)
        .filter(|a| moving_members.contains(a))
        .unwrap_or(merge.moving_group_id);
    let shift = st.piece(anchor_index).map_or((0, 0), |anchor| {
        (
            merge.moving_anchor_x_q.wrapping_sub(anchor.x_q),
            merge.moving_anchor_y_q.wrapping_sub(anchor.y_q),
        )
    });

    let snap_px = (st.cell_w.min(st.cell_h) * SNAP_FRACTION).max(1.0);
    let snap_q = (snap_px * MOTION_Q as f32) as i32;
    let neighbors_ok = groups_are_adjacent(st.cols, &moving_members, &target_members)
        && nearest_neighbor_gap(st, &moving_members, shift, &target_members, rotation)
            <= snap_q * 4;

    if !neighbors_ok {
        let result = st.server_envelope(server_envelope::Body::MergeResult(MergeResult {
            client_merge_id: merge.client_merge_id,
            accepted: false,
            resulting_group_id: 0,
            member_piece_indices: vec![],
            board: None,
            reject_reason: "snap geometry rejected".into(),
        }));
        send_input_to(st, player_id, result);
        return;
    }

    for idx in &moving_members {
        if let Some(p) = st.piece_mut(*idx) {
            p.x_q = p.x_q.wrapping_add(shift.0);
            p.y_q = p.y_q.wrapping_add(shift.1);
        }
    }

    let resulting = merge.moving_group_id.min(merge.target_group_id);
    let mut all_members = moving_members.clone();
    all_members.extend(target_members.iter().copied());
    all_members.sort_unstable();
    all_members.dedup();

    for idx in &all_members {
        if let Some(p) = st.piece_mut(*idx) {
            p.group_id = resulting;
            p.rev = p.rev.wrapping_add(1);
        }
    }
    st.bump_board_rev();
    st.holdings.remove(&merge.moving_group_id);
    st.holdings.remove(&merge.target_group_id);
    // Keep hold on resulting group for the requester.
    st.holdings.insert(
        resulting,
        Hold {
            player_id: player_id.to_string(),
            anchor_piece_index: anchor_index,
            group_id: resulting,
            members: all_members.clone(),
        },
    );

    let result = st.server_envelope(server_envelope::Body::MergeResult(MergeResult {
        client_merge_id: merge.client_merge_id,
        accepted: true,
        resulting_group_id: resulting,
        member_piece_indices: all_members,
        board: Some(st.board.clone()),
        reject_reason: String::new(),
    }));
    send_input_to(st, player_id, result);
}

fn groups_are_adjacent(cols: u32, a: &[u32], b: &[u32]) -> bool {
    let set_b: HashSet<u32> = b.iter().copied().collect();
    for &idx in a {
        let col = idx % cols;
        let row = idx / cols;
        let neighbors = [
            if col > 0 { Some(idx - 1) } else { None },
            if col + 1 < cols { Some(idx + 1) } else { None },
            if row > 0 { Some(idx - cols) } else { None },
            Some(idx + cols),
        ];
        for n in neighbors.into_iter().flatten() {
            if set_b.contains(&n) {
                return true;
            }
        }
    }
    false
}

/// Smallest distance from the joined-neighbours layout over adjacent pairs, with
/// group `a` shifted by `shift_a` and both groups at `rotation`.
fn nearest_neighbor_gap(
    st: &RoomState,
    a: &[u32],
    shift_a: (i32, i32),
    b: &[u32],
    rotation: u32,
) -> i32 {
    let cell_w_q = (st.cell_w * MOTION_Q as f32) as i32;
    let cell_h_q = (st.cell_h * MOTION_Q as f32) as i32;
    let mut best = i32::MAX;
    for &ia in a {
        let Some(pa) = st.piece(ia) else { continue };
        let ax = pa.x_q.wrapping_add(shift_a.0);
        let ay = pa.y_q.wrapping_add(shift_a.1);
        let ca = ia % st.cols;
        let ra = ia / st.cols;
        for &ib in b {
            let cb = ib % st.cols;
            let rb = ib / st.cols;
            let dc = ca as i32 - cb as i32;
            let dr = ra as i32 - rb as i32;
            if dc.abs() + dr.abs() != 1 {
                continue;
            }
            let Some(pb) = st.piece(ib) else { continue };
            // Expected offset in the solved layout, turned with the pieces.
            let (expect_x, expect_y) = turn_offset(
                (cb as i32 - ca as i32) * cell_w_q,
                (rb as i32 - ra as i32) * cell_h_q,
                rotation,
            );
            let dx = pb.x_q.wrapping_sub(ax).wrapping_sub(expect_x);
            let dy = pb.y_q.wrapping_sub(ay).wrapping_sub(expect_y);
            let gap = dx.saturating_abs().saturating_add(dy.saturating_abs());
            best = best.min(gap);
        }
    }
    best
}

fn force_release_player(st: &mut RoomState, player_id: &str, reason: &str) {
    let groups: Vec<u32> = st
        .holdings
        .iter()
        .filter(|(_, h)| h.player_id == player_id)
        .map(|(g, _)| *g)
        .collect();
    if groups.is_empty() {
        return;
    }

    let mut released = Vec::new();
    // Freeze held pieces at last smoothed pose when available.
    let held_sample = st.players.get(player_id).map(|p| p.held.clone());

    for g in groups {
        if let Some(h) = st.holdings.remove(&g) {
            released.extend(h.members.iter().copied());
            if let Some(traj) = &held_sample
                && traj.has_sample
            {
                let sample = traj.to_sample();
                // Apply anchor delta to members relative to stored board anchor.
                if let Some(anchor) = st.piece(h.anchor_piece_index).cloned() {
                    let ox = sample.x_q - anchor.x_q;
                    let oy = sample.y_q - anchor.y_q;
                    for idx in &h.members {
                        if let Some(p) = st.piece_mut(*idx) {
                            p.x_q += ox;
                            p.y_q += oy;
                            p.rev = p.rev.wrapping_add(1);
                        }
                    }
                }
            }
        }
    }
    if !released.is_empty() {
        st.bump_board_rev();
        let event = st.server_envelope(server_envelope::Body::GameEvent(GameEvent {
            kind: game_event::Kind::ForceRelease as i32,
            message: reason.into(),
            released_piece_indices: released,
            board: Some(st.board.clone()),
        }));
        broadcast_input(st, event);
    }
}

fn tick_once(st: &mut RoomState) {
    let now = Instant::now();
    let timed_out: Vec<String> = st
        .players
        .iter()
        .filter(|(_, p)| p.out.is_some() && now.duration_since(p.last_seen) > HEARTBEAT_TIMEOUT)
        .map(|(id, _)| id.clone())
        .collect();

    for pid in &timed_out {
        warn!(player_id = %pid, game_id = %st.game_id, "heartbeat timeout");
        force_release_player(st, pid, "heartbeat timeout");
        if let Some(p) = st.players.get_mut(pid) {
            p.online = false;
            p.out = None;
        }
    }
    if !timed_out.is_empty() {
        let presence = build_presence_frame(st, timed_out.clone());
        broadcast_world(st, presence);
    }

    if st.players.values().all(|p| p.out.is_none()) {
        if st.empty_since.is_none() {
            st.empty_since = Some(Instant::now());
        }
        return;
    }

    st.tick_id = st.tick_id.wrapping_add(1);
    let server_now = now_ms() as f64;
    let force_resync = st.tick_id.is_multiple_of(RESYNC_EVERY_TICKS);

    // Advance trajectories.
    for p in st.players.values_mut() {
        p.cursor.advance_to(server_now);
        p.held.advance_to(server_now);
    }

    let players_pose: Vec<PlayerPose> = st
        .players
        .iter()
        .filter(|(_, p)| p.online && p.out.is_some())
        .map(|(id, p)| {
            let hold = st.holdings.values().find(|h| h.player_id == *id);
            PlayerPose {
                player_id: id.clone(),
                cursor: Some(p.cursor.to_sample()),
                held: if hold.is_some() && p.held.has_sample {
                    Some(p.held.to_sample())
                } else {
                    Some(MotionSample {
                        hide: true,
                        ..Default::default()
                    })
                },
                held_anchor_piece_index: hold.map(|h| h.anchor_piece_index).unwrap_or(0),
                held_group_id: hold.map(|h| h.group_id).unwrap_or(0),
                held_member_indices: hold.map(|h| h.members.clone()).unwrap_or_default(),
            }
        })
        .collect();

    // Per-player ticks (resync flag may differ).
    let player_ids: Vec<String> = st.players.keys().cloned().collect();
    for pid in player_ids {
        let resync = force_resync
            || st
                .players
                .get(&pid)
                .map(|p| p.wants_resync)
                .unwrap_or(false);
        if let Some(p) = st.players.get_mut(&pid) {
            p.wants_resync = false;
        }
        let piece_deltas = if resync {
            st.board.pieces.clone()
        } else {
            // Delta: pieces whose rev changed recently — for v1 send all resting
            // pieces that are not currently held (cheap enough under 200 pieces).
            let held_pieces: HashSet<u32> = st
                .holdings
                .values()
                .flat_map(|h| h.members.iter().copied())
                .collect();
            st.board
                .pieces
                .iter()
                .filter(|p| !held_pieces.contains(&p.piece_index))
                .cloned()
                .collect()
        };

        let tick = Tick {
            tick_id: st.tick_id,
            board_rev: st.board.board_rev,
            players: players_pose.clone(),
            piece_deltas,
            holdings: st.holdings_proto(),
            resync,
        };
        let env = st.server_envelope(server_envelope::Body::Tick(tick));
        let frame = StreamFrame {
            stream: StreamKind::World as i32,
            seq: env.seq,
            time_ms: env.server_time_ms,
            body: Some(crate::proto::game::v1::stream_frame::Body::Server(env)),
        };
        if let Some(p) = st.players.get(&pid)
            && let Some(out) = &p.out
        {
            let _ = out.world_tx.try_send(frame);
        }
    }
}

fn build_presence_frame(st: &mut RoomState, removed: Vec<String>) -> StreamFrame {
    let env = st.server_envelope(server_envelope::Body::Presence(PresenceUpdate {
        players: st.snapshot_players(),
        removed_player_ids: removed,
    }));
    StreamFrame {
        stream: StreamKind::World as i32,
        seq: env.seq,
        time_ms: env.server_time_ms,
        body: Some(crate::proto::game::v1::stream_frame::Body::Server(env)),
    }
}

fn broadcast_world(st: &RoomState, frame: StreamFrame) {
    for p in st.players.values() {
        if let Some(out) = &p.out {
            let _ = out.world_tx.try_send(frame.clone());
        }
    }
}

fn broadcast_input(st: &RoomState, env: ServerEnvelope) {
    let frame = StreamFrame {
        stream: StreamKind::Input as i32,
        seq: env.seq,
        time_ms: env.server_time_ms,
        body: Some(crate::proto::game::v1::stream_frame::Body::Server(env)),
    };
    for p in st.players.values() {
        if let Some(out) = &p.out {
            let _ = out.input_tx.try_send(frame.clone());
        }
    }
}

fn send_input_to(st: &RoomState, player_id: &str, env: ServerEnvelope) {
    let frame = StreamFrame {
        stream: StreamKind::Input as i32,
        seq: env.seq,
        time_ms: env.server_time_ms,
        body: Some(crate::proto::game::v1::stream_frame::Body::Server(env)),
    };
    if let Some(p) = st.players.get(player_id)
        && let Some(out) = &p.out
    {
        let _ = out.input_tx.try_send(frame);
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::game::v1::{ClaimControl, MergeGroups, RotateHeld, stream_frame};

    // 3 x 2 grid of 200 x 160 px cells.
    const CELL_W_Q: i32 = 200 * MOTION_Q;
    const CELL_H_Q: i32 = 160 * MOTION_Q;

    fn room(rotation_enabled: bool) -> RoomState {
        let setup = PuzzleSetup {
            image_url: "https://example.test/p.png".into(),
            image_width: 600,
            image_height: 320,
            piece_count: 6,
            seed: 3,
            rotation_enabled,
        };
        let mut st = RoomState::new("g".into(), setup, 3, 2);
        for p in &mut st.board.pieces {
            p.rotation = 0;
        }
        st
    }

    fn attach(st: &mut RoomState, player_id: &str) -> mpsc::Receiver<StreamFrame> {
        let (input_tx, input_rx) = mpsc::channel(64);
        let (world_tx, _) = mpsc::channel(64);
        let (reply, _) = oneshot::channel();
        handle_command(
            st,
            RoomCommand::Attach {
                player_id: player_id.into(),
                display_name: player_id.into(),
                out: PlayerOut {
                    input_tx,
                    world_tx,
                    dual_bidi: true,
                    transport: TransportKind::Websocket,
                },
                reply,
            },
        );
        input_rx
    }

    fn send(st: &mut RoomState, player_id: &str, body: client_envelope::Body) {
        let seq = st.players[player_id].last_seq + 1;
        apply_client_input(
            st,
            player_id,
            ClientEnvelope {
                seq,
                body: Some(body),
                ..Default::default()
            },
        );
    }

    fn claim(st: &mut RoomState, player_id: &str, anchor: u32) {
        let body = client_envelope::Body::Claim(ClaimControl {
            piece_indices: vec![anchor],
            anchor_piece_index: anchor,
            client_claim_id: 1,
        });
        send(st, player_id, body);
    }

    fn rotate(st: &mut RoomState, player_id: &str, anchor: u32, group_id: u32, turns: u32) {
        let body = client_envelope::Body::Rotate(RotateHeld {
            anchor_piece_index: anchor,
            group_id,
            quarter_turns: turns,
        });
        send(st, player_id, body);
    }

    fn merge(
        st: &mut RoomState,
        rx: &mut mpsc::Receiver<StreamFrame>,
        moving: u32,
        target: u32,
        anchor_q: (i32, i32),
    ) -> MergeResult {
        let request = MergeGroups {
            moving_group_id: moving,
            target_group_id: target,
            moving_anchor_x_q: anchor_q.0,
            moving_anchor_y_q: anchor_q.1,
            client_merge_id: 7,
            ..Default::default()
        };
        send_merge(st, rx, request)
    }

    fn send_merge(
        st: &mut RoomState,
        rx: &mut mpsc::Receiver<StreamFrame>,
        request: MergeGroups,
    ) -> MergeResult {
        send(st, "a", client_envelope::Body::Merge(request));
        let mut found = None;
        while let Ok(frame) = rx.try_recv() {
            if let Some(stream_frame::Body::Server(env)) = frame.body
                && let Some(server_envelope::Body::MergeResult(result)) = env.body
            {
                found = Some(result);
            }
        }
        found.expect("merge result")
    }

    fn place(st: &mut RoomState, index: u32, pos: (i32, i32), rotation: u32, group_id: u32) {
        let p = st.piece_mut(index).unwrap();
        (p.x_q, p.y_q) = pos;
        p.rotation = rotation;
        p.group_id = group_id;
    }

    fn pos(st: &RoomState, index: u32) -> (i32, i32) {
        let p = st.piece(index).unwrap();
        (p.x_q, p.y_q)
    }

    /// Where piece `index` sits when joined to piece 0 at `origin`, turned `rotation`.
    fn joined(origin: (i32, i32), index: u32, rotation: u32) -> (i32, i32) {
        let col = (index % 3) as i32;
        let row = (index / 3) as i32;
        let (ox, oy) = turn_offset(col * CELL_W_Q, row * CELL_H_Q, rotation);
        (origin.0 + ox, origin.1 + oy)
    }

    #[test]
    fn rotate_ignored_without_rotation_mode() {
        let mut st = room(false);
        let _rx = attach(&mut st, "a");
        claim(&mut st, "a", 0);
        let before = st.board.clone();
        rotate(&mut st, "a", 0, 0, 1);
        assert_eq!(st.board, before);
    }

    #[test]
    fn rotate_ignored_for_non_holder_and_zero_turns() {
        let mut st = room(true);
        let _ra = attach(&mut st, "a");
        let _rb = attach(&mut st, "b");
        claim(&mut st, "a", 0);
        let before = st.board.clone();
        rotate(&mut st, "b", 0, 0, 1);
        rotate(&mut st, "b", 1, 1, 1);
        rotate(&mut st, "a", 0, 0, 4);
        rotate(&mut st, "a", 1, 1, 1);
        assert_eq!(st.board, before);
    }

    #[test]
    fn rotate_wraps_in_both_directions() {
        let mut st = room(true);
        let _rx = attach(&mut st, "a");
        claim(&mut st, "a", 4);
        let start = pos(&st, 4);
        for (turns, expected) in [(1, [1, 2, 3, 0]), (3, [3, 2, 1, 0])] {
            for want in expected {
                let board_rev = st.board.board_rev;
                let rev = st.piece(4).unwrap().rev;
                rotate(&mut st, "a", 4, 4, turns);
                let p = st.piece(4).unwrap();
                assert_eq!(p.rotation, want);
                assert_eq!((p.x_q, p.y_q), start);
                assert_eq!(p.rev, rev + 1);
                assert_eq!(st.board.board_rev, board_rev + 1);
            }
        }
    }

    #[test]
    fn rotate_uses_pivot_piece_when_group_id_is_stale() {
        let mut st = room(true);
        let _rx = attach(&mut st, "a");
        let origin = (40_000, 40_000);
        place(&mut st, 0, origin, 0, 0);
        place(&mut st, 1, joined(origin, 1, 0), 0, 0);
        claim(&mut st, "a", 0);

        let pivot = pos(&st, 1);
        rotate(&mut st, "a", 1, 1, 1);
        assert_eq!(pos(&st, 1), pivot);
        let (ox, oy) = turn_offset(-CELL_W_Q, 0, 1);
        assert_eq!(pos(&st, 0), (pivot.0 + ox, pivot.1 + oy));
        assert_eq!(st.piece(0).unwrap().rotation, 1);
        assert_eq!(st.piece(1).unwrap().rotation, 1);

        let holdings = st.holdings_proto();
        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].anchor_piece_index, 1);
        assert_eq!(holdings[0].rotation, 1);
    }

    #[test]
    fn rotate_falls_back_to_held_group_id() {
        let mut st = room(true);
        let _rx = attach(&mut st, "a");
        let origin = (40_000, 40_000);
        place(&mut st, 0, origin, 0, 0);
        place(&mut st, 1, joined(origin, 1, 0), 0, 0);
        claim(&mut st, "a", 0);

        rotate(&mut st, "a", 99, 0, 3);
        assert_eq!(pos(&st, 0), origin);
        assert_eq!(pos(&st, 1), joined(origin, 1, 3));
        assert_eq!(st.holdings_proto()[0].rotation, 3);
    }

    #[test]
    fn held_group_reports_its_own_rotation() {
        let mut st = room(true);
        let _rx = attach(&mut st, "a");
        st.piece_mut(1).unwrap().rotation = 2;
        claim(&mut st, "a", 0);
        // MoveHeld can name an anchor outside the held group.
        st.holdings.get_mut(&0).unwrap().anchor_piece_index = 1;
        assert_eq!(st.holdings_proto()[0].rotation, 0);
    }

    #[test]
    fn merge_accepts_turned_offset_within_threshold() {
        for rotation in 0..4 {
            let mut st = room(true);
            let mut rx = attach(&mut st, "a");
            let origin = (40_000, 40_000);
            place(&mut st, 0, origin, rotation, 0);
            let (tx, ty) = joined(origin, 1, rotation);
            place(&mut st, 1, (tx + 300, ty - 200), rotation, 1);
            claim(&mut st, "a", 0);

            let result = merge(&mut st, &mut rx, 0, 1, origin);
            assert!(
                result.accepted,
                "rotation {rotation}: {}",
                result.reject_reason
            );
            assert_eq!(result.resulting_group_id, 0);
            for i in [0, 1] {
                let p = st.piece(i).unwrap();
                assert_eq!((p.group_id, p.rotation), (0, rotation));
            }
        }
    }

    #[test]
    fn merge_rejects_outside_threshold_and_leaves_board() {
        let mut st = room(true);
        let mut rx = attach(&mut st, "a");
        let origin = (40_000, 40_000);
        place(&mut st, 0, origin, 1, 0);
        // Upright layout, which is not joined at rotation 1.
        place(&mut st, 1, joined(origin, 1, 0), 1, 1);
        claim(&mut st, "a", 0);
        let before = st.board.clone();

        let result = merge(&mut st, &mut rx, 0, 1, (origin.0 + 40, origin.1));
        assert!(!result.accepted);
        assert_eq!(result.reject_reason, "snap geometry rejected");
        assert_eq!(st.board, before);
    }

    #[test]
    fn merge_rejects_mismatched_rotation_and_leaves_board() {
        let mut st = room(true);
        let mut rx = attach(&mut st, "a");
        let origin = (40_000, 40_000);
        place(&mut st, 0, origin, 1, 0);
        place(&mut st, 1, joined(origin, 1, 1), 2, 1);
        claim(&mut st, "a", 0);
        let before = st.board.clone();

        let result = merge(&mut st, &mut rx, 0, 1, (origin.0 + 40, origin.1));
        assert!(!result.accepted);
        assert_eq!(result.reject_reason, "rotation mismatch");
        assert_eq!(st.board, before);
    }

    #[test]
    fn merge_rejects_unlisted_member_with_other_rotation() {
        let mut st = room(true);
        let mut rx = attach(&mut st, "a");
        let origin = (40_000, 40_000);
        // Group 0 (pieces 0 and 3) is turned differently from pieces 4 and 5.
        place(&mut st, 0, origin, 2, 0);
        place(&mut st, 3, joined(origin, 3, 2), 2, 0);
        let held = (90_000, 90_000);
        place(&mut st, 4, held, 1, 4);
        let (ox, oy) = turn_offset(CELL_W_Q, 0, 1);
        place(&mut st, 5, (held.0 + ox, held.1 + oy), 1, 5);
        claim(&mut st, "a", 4);
        let before = st.board.clone();

        // The lists name only pieces that match; the target group does not.
        let request = MergeGroups {
            moving_group_id: 4,
            target_group_id: 0,
            moving_member_indices: vec![4],
            target_member_indices: vec![5],
            moving_anchor_x_q: held.0,
            moving_anchor_y_q: held.1,
            client_merge_id: 7,
        };
        let result = send_merge(&mut st, &mut rx, request);
        assert!(!result.accepted);
        assert_eq!(result.reject_reason, "rotation mismatch");
        assert_eq!(st.board, before);
    }

    #[test]
    fn merge_held_by_non_representative_piece_keeps_anchor() {
        let mut st = room(true);
        let mut rx = attach(&mut st, "a");
        let origin = (20_000, 20_000);
        place(&mut st, 0, origin, 1, 0);
        place(&mut st, 1, joined(origin, 1, 1), 1, 0);
        place(&mut st, 2, (90_000, 90_000), 1, 2);
        claim(&mut st, "a", 1);

        // The client drags piece 1 to where it joins piece 2.
        let (ox, oy) = turn_offset(CELL_W_Q, 0, 1);
        let anchor_q = (90_000 - ox, 90_000 - oy);
        let result = merge(&mut st, &mut rx, 0, 2, anchor_q);
        assert!(result.accepted, "{}", result.reject_reason);
        assert_eq!(result.member_piece_indices, vec![0, 1, 2]);
        assert_eq!(pos(&st, 1), anchor_q);
        assert_eq!(pos(&st, 0), (anchor_q.0 - ox, anchor_q.1 - oy));

        let holdings = st.holdings_proto();
        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].group_id, 0);
        assert_eq!(holdings[0].anchor_piece_index, 1);

        // The client still names the merged group by its own id.
        rotate(&mut st, "a", 1, 2, 1);
        assert_eq!(pos(&st, 1), anchor_q);
        assert!((0..3).all(|i| st.piece(i).unwrap().rotation == 2));
    }

    #[test]
    fn completed_puzzle_is_one_group_with_one_rotation() {
        let mut st = room(true);
        let mut rx = attach(&mut st, "a");
        let origin = (60_000, 60_000);
        for i in 0..6 {
            let (x, y) = joined(origin, i, 3);
            place(&mut st, i, (x + 100 * i as i32, y - 50), 3, i);
        }
        place(&mut st, 0, origin, 3, 0);
        claim(&mut st, "a", 0);
        for target in 1..6 {
            let result = merge(&mut st, &mut rx, 0, target, origin);
            assert!(result.accepted, "{target}: {}", result.reject_reason);
        }
        let groups: HashSet<u32> = st.board.pieces.iter().map(|p| p.group_id).collect();
        let rotations: HashSet<u32> = st.board.pieces.iter().map(|p| p.rotation).collect();
        assert_eq!(groups.len(), 1);
        assert_eq!(rotations, HashSet::from([3]));
    }
}
