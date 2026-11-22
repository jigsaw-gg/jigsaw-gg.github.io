//! Application-level network impairment for the raw UDP relay.
//!
//! Delays are sampled independently per datagram so jitter can reorder
//! packets (similar to netem with a delay distribution). JOIN registration
//! datagrams are never impaired so peers can still connect reliably.

use crate::config::Config;
use rand::Rng;
use std::time::Duration;
use tracing::info;

#[derive(Debug, Clone)]
pub struct NetSim {
    /// Mean one-way delay.
    latency: Duration,
    /// Half-range of uniform jitter around [`Self::latency`] (clamped at 0).
    jitter: Duration,
    /// Chance (0–100) to drop a datagram.
    drop_percent: f64,
    /// Chance (0–100) to send a datagram twice after the delay.
    dup_percent: f64,
}

impl NetSim {
    pub fn from_config(config: &Config) -> anyhow::Result<Self> {
        validate_percent("net-udp-drop-percent", config.net_udp_drop_percent)?;
        validate_percent("net-udp-dup-percent", config.net_udp_dup_percent)?;

        let sim = Self {
            latency: Duration::from_millis(config.net_latency_ms),
            jitter: Duration::from_millis(config.net_latency_jitter_ms),
            drop_percent: config.net_udp_drop_percent,
            dup_percent: config.net_udp_dup_percent,
        };

        if sim.enabled() {
            info!(
                latency_ms = config.net_latency_ms,
                jitter_ms = config.net_latency_jitter_ms,
                drop_percent = sim.drop_percent,
                dup_percent = sim.dup_percent,
                "UDP network simulation enabled"
            );
        }

        Ok(sim)
    }

    pub fn enabled(&self) -> bool {
        !self.latency.is_zero()
            || !self.jitter.is_zero()
            || self.drop_percent > 0.0
            || self.dup_percent > 0.0
    }

    /// Uniform sample in `[latency - jitter, latency + jitter]`, floored at 0.
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

    pub fn should_drop(&self) -> bool {
        roll_percent(self.drop_percent)
    }

    pub fn should_duplicate(&self) -> bool {
        roll_percent(self.dup_percent)
    }

    /// Sleep for a sampled delay when simulation is active.
    pub async fn apply_delay(&self) {
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
