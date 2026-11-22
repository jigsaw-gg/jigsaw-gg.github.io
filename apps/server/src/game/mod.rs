//! Authoritative game sync (`game.v1`).
//!
//! All play transports (WebTransport `/game`, WebSocket `/game`) share one
//! in-memory [`store::GameStore`] so independently connected clients see the
//! same definition and live room state.

pub mod framing;
mod grid;
mod motion;
mod room;
mod rotation;
mod store;
pub mod sync;

pub use store::{GameStore, StoreError};
pub use sync::handle_websocket_game;

pub mod constants {
    use std::time::Duration;

    pub const GAME_TTL: Duration = Duration::from_secs(24 * 60 * 60);
    pub const TICK_HZ: u32 = 10;
    pub const TICK_INTERVAL: Duration = Duration::from_millis(100);
    pub const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);
    pub const HEARTBEAT_TIMEOUT_MS: u32 = 10_000;
    pub const EMPTY_ROOM_GRACE: Duration = Duration::from_secs(60);
    pub const RESYNC_EVERY_TICKS: u64 = 50; // ~5s at 10 Hz
    pub const MOTION_Q: i32 = 32;
    pub const MAX_PIECE_COUNT: u32 = 200;
    pub const SNAP_FRACTION: f32 = 0.05;
    pub const CORRECTION_MIN_MS: f32 = 80.0;
    pub const CORRECTION_MAX_MS: f32 = 200.0;
    pub const SCATTER_SALT: u32 = 81_001;
    pub const ROTATION_SALT: u32 = 90_017;
    pub const SLOT_GAP: f32 = 0.28 * 2.0;
    pub const SLOT_JITTER: f32 = 0.08;
    pub const RESERVE_RATIO: f32 = 16.0 / 9.0;
}
