//! Shared in-memory game definitions + live rooms.
//!
//! One [`GameStore`] is cloned into every transport / gRPC service so all
//! clients observe the same authoritative state.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use tracing::{info, warn};

use crate::game::constants::GAME_TTL;
use crate::game::grid::{choose_grid, setups_equivalent, validate_setup};
use crate::game::room::{PlayerOut, RoomHandle};
use crate::proto::game::v1::{
    BoardSnapshot, CreateGameRequest, CreateGameResponse, GetGameResponse, JoinGameRequest,
    JoinGameResponse, LeaveGameResponse, PlayEndpoints, PlayerInfo, PuzzleSetup, TransportKind,
    TransportPreference,
};

#[derive(Debug, Clone)]
pub struct GameDefinition {
    pub game_id: String,
    pub setup: PuzzleSetup,
    pub cols: u32,
    pub rows: u32,
    pub creator_player_id: String,
    pub created_at_ms: i64,
    pub last_activity_at: Instant,
    pub expires_at: Instant,
}

impl GameDefinition {
    pub fn expires_at_ms(&self) -> i64 {
        let elapsed = self.expires_at.saturating_duration_since(Instant::now());
        // Convert absolute Instant to wall clock via created offset.
        now_ms() + elapsed.as_millis() as i64
    }

    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }

    pub fn touch(&mut self) {
        let now = Instant::now();
        self.last_activity_at = now;
        self.expires_at = now + GAME_TTL;
    }
}

#[derive(Clone)]
pub struct GameStore {
    inner: Arc<GameStoreInner>,
}

struct GameStoreInner {
    definitions: DashMap<String, GameDefinition>,
    rooms: DashMap<String, Arc<RoomHandle>>,
}

impl GameStore {
    pub fn new() -> Self {
        let store = Self {
            inner: Arc::new(GameStoreInner {
                definitions: DashMap::new(),
                rooms: DashMap::new(),
            }),
        };
        store.spawn_janitor();
        store
    }

    fn spawn_janitor(&self) {
        let store = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                store.sweep().await;
            }
        });
    }

    async fn sweep(&self) {
        let expired: Vec<String> = self
            .inner
            .definitions
            .iter()
            .filter(|e| e.value().is_expired())
            .map(|e| e.key().clone())
            .collect();

        for game_id in expired {
            warn!(%game_id, "game TTL expired — dropping definition and room");
            self.inner.rooms.remove(&game_id);
            self.inner.definitions.remove(&game_id);
        }

        let empty_rooms: Vec<String> = {
            let mut ids = Vec::new();
            for entry in self.inner.rooms.iter() {
                if entry.value().should_destroy().await {
                    ids.push(entry.key().clone());
                }
            }
            ids
        };
        for game_id in empty_rooms {
            info!(%game_id, "destroying empty room after grace");
            self.inner.rooms.remove(&game_id);
        }
    }

    pub fn touch_activity(&self, game_id: &str) {
        if let Some(mut def) = self.inner.definitions.get_mut(game_id) {
            def.touch();
        }
    }

    pub fn create_game(&self, req: CreateGameRequest) -> Result<CreateGameResponse, StoreError> {
        let setup = req
            .setup
            .ok_or(StoreError::Invalid("setup required".into()))?;
        validate_setup(&setup).map_err(StoreError::Invalid)?;

        let (cols, rows) = choose_grid(setup.piece_count, setup.image_width, setup.image_height);
        let game_id = if req.game_id.is_empty() {
            new_game_id()
        } else {
            req.game_id
        };

        if let Some(existing) = self.inner.definitions.get(&game_id) {
            if setups_equivalent(&existing.setup, &setup) {
                let mut owned = existing.clone();
                drop(existing);
                if let Some(mut e) = self.inner.definitions.get_mut(&game_id) {
                    e.touch();
                    owned = e.clone();
                }
                return Ok(CreateGameResponse {
                    game_id: owned.game_id.clone(),
                    setup: Some(owned.setup.clone()),
                    created_at_ms: owned.created_at_ms,
                    expires_at_ms: owned.expires_at_ms(),
                    cols: owned.cols,
                    rows: owned.rows,
                });
            }
            return Err(StoreError::Conflict(
                "game_id exists with different setup".into(),
            ));
        }

        let now = Instant::now();
        let def = GameDefinition {
            game_id: game_id.clone(),
            setup: setup.clone(),
            cols,
            rows,
            creator_player_id: req.creator_player_id,
            created_at_ms: now_ms(),
            last_activity_at: now,
            expires_at: now + GAME_TTL,
        };

        self.inner.definitions.insert(game_id.clone(), def.clone());
        info!(%game_id, cols, rows, "CreateGame");

        Ok(CreateGameResponse {
            game_id,
            setup: Some(setup),
            created_at_ms: def.created_at_ms,
            expires_at_ms: def.expires_at_ms(),
            cols,
            rows,
        })
    }

    pub fn get_game(&self, game_id: &str) -> Result<GetGameResponse, StoreError> {
        let def = self
            .inner
            .definitions
            .get(game_id)
            .ok_or(StoreError::NotFound)?;
        let expired = def.is_expired();
        Ok(GetGameResponse {
            game_id: def.game_id.clone(),
            setup: Some(def.setup.clone()),
            created_at_ms: def.created_at_ms,
            expires_at_ms: def.expires_at_ms(),
            cols: def.cols,
            rows: def.rows,
            creator_player_id: def.creator_player_id.clone(),
            expired,
        })
    }

    pub async fn join_game(&self, req: JoinGameRequest) -> Result<JoinGameResponse, StoreError> {
        if req.game_id.is_empty() || req.player_id.is_empty() {
            return Err(StoreError::Invalid("game_id and player_id required".into()));
        }

        let (setup, cols, rows, expires_at_ms) = {
            let mut def = self
                .inner
                .definitions
                .get_mut(&req.game_id)
                .ok_or(StoreError::NotFound)?;
            if def.is_expired() {
                return Err(StoreError::Expired);
            }
            def.touch();
            (def.setup.clone(), def.cols, def.rows, def.expires_at_ms())
        };

        let room = self.ensure_room(&req.game_id, setup.clone(), cols, rows);
        room.register_player(req.player_id.clone(), req.display_name.clone())
            .await
            .map_err(StoreError::Invalid)?;
        let board = room.board_snapshot().await;
        let players = room.player_infos().await;

        let (negotiated, play) =
            self.play_endpoints(&req.game_id, &req.player_id, req.preferred_transport);

        Ok(JoinGameResponse {
            game_id: req.game_id,
            player_id: req.player_id,
            setup: Some(setup),
            cols,
            rows,
            server_time_ms: now_ms(),
            expires_at_ms,
            board: Some(board),
            players,
            play: Some(play),
            negotiated_transport: negotiated as i32,
        })
    }

    pub async fn leave_game(
        &self,
        game_id: &str,
        player_id: &str,
    ) -> Result<LeaveGameResponse, StoreError> {
        if let Some(room) = self.inner.rooms.get(game_id) {
            room.detach(player_id, true).await;
        }
        self.touch_activity(game_id);
        Ok(LeaveGameResponse {})
    }

    fn ensure_room(
        &self,
        game_id: &str,
        setup: PuzzleSetup,
        cols: u32,
        rows: u32,
    ) -> Arc<RoomHandle> {
        if let Some(existing) = self.inner.rooms.get(game_id) {
            return existing.clone();
        }
        let room = RoomHandle::spawn(game_id.to_string(), setup, cols, rows);
        self.inner.rooms.insert(game_id.to_string(), room.clone());
        info!(%game_id, "live room created");
        room
    }

    pub fn room(&self, game_id: &str) -> Option<Arc<RoomHandle>> {
        self.inner.rooms.get(game_id).map(|r| r.clone())
    }

    pub async fn attach_player(
        &self,
        game_id: &str,
        player_id: &str,
        display_name: &str,
        out: PlayerOut,
    ) -> Result<
        (
            BoardSnapshot,
            Vec<PlayerInfo>,
            crate::proto::game::v1::StreamFrame,
        ),
        StoreError,
    > {
        let def = self
            .inner
            .definitions
            .get(game_id)
            .ok_or(StoreError::NotFound)?;
        if def.is_expired() {
            return Err(StoreError::Expired);
        }
        let setup = def.setup.clone();
        let cols = def.cols;
        let rows = def.rows;
        drop(def);

        self.touch_activity(game_id);
        let room = self.ensure_room(game_id, setup, cols, rows);
        let attached = room
            .attach(player_id.to_string(), display_name.to_string(), out)
            .await
            .map_err(StoreError::Invalid)?;
        Ok((attached.board, attached.players, attached.welcome))
    }

    fn play_endpoints(
        &self,
        game_id: &str,
        player_id: &str,
        preferred: i32,
    ) -> (TransportKind, PlayEndpoints) {
        // Path + query only — client owns scheme/host/port for WT and WS bases.
        let path = format!(
            "/game?game_id={}&player_id={}",
            urlencoding_lite(game_id),
            urlencoding_lite(player_id),
        );

        let negotiated = match TransportPreference::try_from(preferred).unwrap_or_default() {
            TransportPreference::Websocket => TransportKind::Websocket,
            _ => TransportKind::Webtransport,
        };

        (
            negotiated,
            PlayEndpoints {
                webtransport_path: path.clone(),
                websocket_path: path,
            },
        )
    }
}

#[derive(Debug)]
pub enum StoreError {
    NotFound,
    Expired,
    Conflict(String),
    Invalid(String),
}

impl StoreError {
    pub fn message(&self) -> String {
        match self {
            Self::NotFound => "game not found".into(),
            Self::Expired => "game expired".into(),
            Self::Conflict(m) | Self::Invalid(m) => m.clone(),
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_game_id() -> String {
    // NanoID-compatible alphabet, 21 chars.
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    let uuid = uuid::Uuid::new_v4();
    let bytes = uuid.as_bytes();
    let mut out = String::with_capacity(21);
    // Mix two UUIDs for enough entropy.
    let uuid2 = uuid::Uuid::new_v4();
    let bytes2 = uuid2.as_bytes();
    for i in 0..21 {
        let b = if i < 16 { bytes[i] } else { bytes2[i - 16] };
        out.push(ALPHABET[(b as usize) % ALPHABET.len()] as char);
    }
    out
}

fn urlencoding_lite(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(char::from(nibble(b >> 4)));
                out.push(char::from(nibble(b & 0xf)));
            }
        }
    }
    out
}

fn nibble(n: u8) -> u8 {
    if n < 10 { b'0' + n } else { b'A' + (n - 10) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(rotation_enabled: bool) -> CreateGameRequest {
        CreateGameRequest {
            game_id: "rot-game".into(),
            creator_player_id: "p1".into(),
            creator_display_name: "P1".into(),
            setup: Some(PuzzleSetup {
                image_url: "https://example.test/p.png".into(),
                image_width: 600,
                image_height: 500,
                piece_count: 30,
                seed: 5,
                rotation_enabled,
            }),
        }
    }

    #[tokio::test]
    async fn create_with_different_rotation_mode_conflicts() {
        let store = GameStore::new();
        let created = store.create_game(request(true)).unwrap();
        assert!(created.setup.unwrap().rotation_enabled);
        assert!(store.create_game(request(true)).is_ok());
        assert!(matches!(
            store.create_game(request(false)),
            Err(StoreError::Conflict(_))
        ));
        assert!(
            store
                .get_game("rot-game")
                .unwrap()
                .setup
                .unwrap()
                .rotation_enabled
        );
    }
}
