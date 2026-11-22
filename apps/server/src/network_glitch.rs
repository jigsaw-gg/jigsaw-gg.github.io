//! Application-level network impairment for play `/game` and opaque relay pipes.
//!
//! Delays are sampled independently per frame/datagram so jitter can reorder
//! deliveries. Welcome on `/game` and WebSocket ping/pong are never impaired.

use crate::config::Config;
use rand::Rng;
use std::time::Duration;
use tracing::{debug, info};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutboundPlan {
    Drop,
    Once,
    Twice,
}

#[derive(Debug, Clone)]
pub struct NetworkGlitch {
    latency: Duration,
    jitter: Duration,
    drop_percent: f64,
    dup_percent: f64,
}

impl NetworkGlitch {
    pub fn from_config(config: &Config) -> anyhow::Result<Self> {
        validate_percent(
            "NETWORK_GLITCH_DROP_PERCENT",
            config.network_glitch_drop_percent,
        )?;
        validate_percent(
            "NETWORK_GLITCH_DUP_PERCENT",
            config.network_glitch_dup_percent,
        )?;

        let glitch = Self {
            latency: Duration::from_millis(config.network_glitch_latency_ms),
            jitter: Duration::from_millis(config.network_glitch_latency_jitter_ms),
            drop_percent: config.network_glitch_drop_percent,
            dup_percent: config.network_glitch_dup_percent,
        };

        if glitch.enabled() {
            info!(
                latency_ms = config.network_glitch_latency_ms,
                jitter_ms = config.network_glitch_latency_jitter_ms,
                drop_percent = glitch.drop_percent,
                dup_percent = glitch.dup_percent,
                "network glitch simulation enabled"
            );
        }

        Ok(glitch)
    }

    pub fn enabled(&self) -> bool {
        !self.latency.is_zero()
            || !self.jitter.is_zero()
            || self.drop_percent > 0.0
            || self.dup_percent > 0.0
    }

    /// `true` when the payload should be discarded (drop rolled).
    pub async fn impair_inbound(&self) -> bool {
        if !self.enabled() {
            return false;
        }
        if self.should_drop() {
            debug!("inbound drop (network glitch)");
            return true;
        }
        self.apply_delay().await;
        false
    }

    /// Whether an outbound payload should be sent once, twice, or not at all.
    pub async fn plan_outbound(&self, label: &'static str) -> OutboundPlan {
        if !self.enabled() {
            return OutboundPlan::Once;
        }
        if self.should_drop() {
            debug!(%label, "outbound drop (network glitch)");
            return OutboundPlan::Drop;
        }
        self.apply_delay().await;
        if self.should_duplicate() {
            debug!(%label, "outbound duplicate (network glitch)");
            OutboundPlan::Twice
        } else {
            OutboundPlan::Once
        }
    }

    pub async fn duplicate_outbound_delay(&self) {
        self.apply_delay().await;
    }

    pub async fn should_repeat_inbound(&self) -> bool {
        if !self.enabled() || !self.should_duplicate() {
            return false;
        }
        debug!("inbound duplicate (network glitch)");
        self.apply_delay().await;
        true
    }

    pub fn sample_delay(&self) -> Duration {
        if self.latency.is_zero() && self.jitter.is_zero() {
            return Duration::ZERO;
        }

        let mean_ms = self.latency.as_secs_f64() * 1_000.0;
        let jitter_ms = self.jitter.as_secs_f64() * 1_000.0;
        let lo = (mean_ms - jitter_ms).max(0.0);
        let hi = mean_ms + jitter_ms;

        let ms = if (hi - lo).abs() < f64::EPSILON {
            lo
        } else {
            rand::rng().random_range(lo..=hi)
        };

        Duration::from_secs_f64(ms / 1_000.0)
    }

    fn should_drop(&self) -> bool {
        roll_percent(self.drop_percent)
    }

    fn should_duplicate(&self) -> bool {
        roll_percent(self.dup_percent)
    }

    async fn apply_delay(&self) {
        let delay = self.sample_delay();
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }
}

fn roll_percent(percent: f64) -> bool {
    percent > 0.0 && rand::rng().random_range(0.0..100.0) < percent
}

fn validate_percent(name: &str, value: f64) -> anyhow::Result<()> {
    if !(0.0..=100.0).contains(&value) || value.is_nan() {
        anyhow::bail!("{name} must be between 0 and 100 (got {value})");
    }
    Ok(())
}
