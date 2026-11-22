//! Deploy-time git metadata from `BUILD_COMMIT` / `BUILD_COMMIT_LOG` (see Dockerfile).

use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
pub struct BuildInfo {
    pub commit: String,
    pub log: String,
}

static CACHED: OnceLock<BuildInfo> = OnceLock::new();

pub fn build_info() -> &'static BuildInfo {
    CACHED.get_or_init(|| BuildInfo {
        commit: std::env::var("BUILD_COMMIT")
            .unwrap_or_default()
            .trim()
            .to_string(),
        log: std::env::var("BUILD_COMMIT_LOG")
            .unwrap_or_default()
            .trim()
            .to_string(),
    })
}
