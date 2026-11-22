//! Server-side motion repair (Hermite-ish integrate + blend on gaps).
//!
//! Ingest honors [`MotionSample`] wire semantics from `game.proto`:
//! - `absolute=true` (or `anchor`) → world-table pose
//! - `absolute=false` → delta from the last accepted knot on this trajectory
//! - relative with no prior basis → ignored
//! - `hide=true` clears the trajectory (not a pose at 0,0)
//!
//! Tick / downlink samples from [`Trajectory::to_sample`] are always absolute.

use crate::game::constants::{CORRECTION_MAX_MS, CORRECTION_MIN_MS, MOTION_Q};
use crate::proto::game::v1::MotionSample;

#[derive(Debug, Clone)]
pub struct Trajectory {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub ax: f32,
    pub ay: f32,
    pub t_ms: f64,
    pub hide: bool,
    pub has_sample: bool,
    /// Last accepted knot world pose (basis for relative samples).
    basis_x: f32,
    basis_y: f32,
    correction: Option<Correction>,
}

#[derive(Debug, Clone)]
struct Correction {
    start_x: f32,
    start_y: f32,
    start_vx: f32,
    start_vy: f32,
    target_x: f32,
    target_y: f32,
    target_vx: f32,
    target_vy: f32,
    start_t_ms: f64,
    duration_ms: f32,
    hide: bool,
}

impl Default for Trajectory {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            vx: 0.0,
            vy: 0.0,
            ax: 0.0,
            ay: 0.0,
            t_ms: 0.0,
            hide: true,
            has_sample: false,
            basis_x: 0.0,
            basis_y: 0.0,
            correction: None,
        }
    }
}

impl Trajectory {
    pub fn push_sample(&mut self, sample: &MotionSample, server_now_ms: f64) {
        // hide clears / conceals the trajectory; coordinates are not a world pose.
        if sample.hide {
            self.hide = true;
            self.has_sample = false;
            self.correction = None;
            self.vx = 0.0;
            self.vy = 0.0;
            self.ax = 0.0;
            self.ay = 0.0;
            self.t_ms = server_now_ms;
            return;
        }

        // anchor implies absolute (exact pose).
        let absolute = sample.absolute || sample.anchor;
        // Relative with no prior basis is ignored (same as browser MotionTrack).
        if !absolute && !self.has_sample {
            return;
        }

        let qx = dequantize(sample.x_q);
        let qy = dequantize(sample.y_q);
        let vx = dequantize(sample.vx_q);
        let vy = dequantize(sample.vy_q);
        let ax = dequantize(sample.ax_q);
        let ay = dequantize(sample.ay_q);

        let (x, y) = if absolute {
            (qx, qy)
        } else {
            (self.basis_x + qx, self.basis_y + qy)
        };

        // Knot basis advances immediately; broadcast pose may blend toward it.
        self.basis_x = x;
        self.basis_y = y;

        if !self.has_sample {
            self.x = x;
            self.y = y;
            self.vx = if sample.anchor { 0.0 } else { vx };
            self.vy = if sample.anchor { 0.0 } else { vy };
            self.ax = if sample.anchor { 0.0 } else { ax };
            self.ay = if sample.anchor { 0.0 } else { ay };
            self.t_ms = server_now_ms;
            self.hide = false;
            self.has_sample = true;
            self.correction = None;
            return;
        }

        // Advance prediction to now, then measure error vs resolved world target.
        self.advance_to(server_now_ms);
        let err_x = x - self.x;
        let err_y = y - self.y;
        let err = (err_x * err_x + err_y * err_y).sqrt();

        if err < 1.0 / MOTION_Q as f32 || sample.anchor {
            self.x = x;
            self.y = y;
            self.vx = if sample.anchor { 0.0 } else { vx };
            self.vy = if sample.anchor { 0.0 } else { vy };
            self.ax = if sample.anchor { 0.0 } else { ax };
            self.ay = if sample.anchor { 0.0 } else { ay };
            self.hide = false;
            self.correction = None;
            return;
        }

        let duration = (CORRECTION_MIN_MS + (err * 2.0).min(CORRECTION_MAX_MS - CORRECTION_MIN_MS))
            .clamp(CORRECTION_MIN_MS, CORRECTION_MAX_MS);
        self.correction = Some(Correction {
            start_x: self.x,
            start_y: self.y,
            start_vx: self.vx,
            start_vy: self.vy,
            target_x: x,
            target_y: y,
            target_vx: vx,
            target_vy: vy,
            start_t_ms: server_now_ms,
            duration_ms: duration,
            hide: false,
        });
        self.ax = ax;
        self.ay = ay;
        self.hide = false;
    }

    pub fn advance_to(&mut self, server_now_ms: f64) {
        if !self.has_sample {
            self.t_ms = server_now_ms;
            return;
        }

        if let Some(corr) = self.correction.clone() {
            let elapsed = (server_now_ms - corr.start_t_ms) as f32;
            if elapsed >= corr.duration_ms {
                self.x = corr.target_x;
                self.y = corr.target_y;
                self.vx = corr.target_vx;
                self.vy = corr.target_vy;
                self.hide = corr.hide;
                self.correction = None;
                self.t_ms = server_now_ms;
            } else {
                let u = (elapsed / corr.duration_ms).clamp(0.0, 1.0);
                // Smoothstep blend of pose + velocity.
                let s = u * u * (3.0 - 2.0 * u);
                self.x = corr.start_x + (corr.target_x - corr.start_x) * s;
                self.y = corr.start_y + (corr.target_y - corr.start_y) * s;
                self.vx = corr.start_vx + (corr.target_vx - corr.start_vx) * s;
                self.vy = corr.start_vy + (corr.target_vy - corr.start_vy) * s;
                self.hide = corr.hide;
                self.t_ms = server_now_ms;
            }
            return;
        }

        let dt = ((server_now_ms - self.t_ms) / 1000.0).max(0.0) as f32;
        if dt <= 0.0 {
            return;
        }
        self.x += self.vx * dt + 0.5 * self.ax * dt * dt;
        self.y += self.vy * dt + 0.5 * self.ay * dt * dt;
        self.vx += self.ax * dt;
        self.vy += self.ay * dt;
        self.t_ms = server_now_ms;
    }

    pub fn to_sample(&self) -> MotionSample {
        MotionSample {
            hide: self.hide || !self.has_sample,
            anchor: false,
            absolute: true,
            x_q: quantize(self.x),
            y_q: quantize(self.y),
            dt_ms: 0,
            vx_q: quantize(self.vx),
            vy_q: quantize(self.vy),
            ax_q: quantize(self.ax),
            ay_q: quantize(self.ay),
            client_time_ms: 0,
        }
    }
}

fn quantize(px: f32) -> i32 {
    (px * MOTION_Q as f32).round() as i32
}

fn dequantize(q: i32) -> f32 {
    q as f32 / MOTION_Q as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(absolute: bool, anchor: bool, hide: bool, x_px: f32, y_px: f32) -> MotionSample {
        MotionSample {
            hide,
            anchor,
            absolute,
            x_q: quantize(x_px),
            y_q: quantize(y_px),
            dt_ms: 16,
            vx_q: 0,
            vy_q: 0,
            ax_q: 0,
            ay_q: 0,
            client_time_ms: 0,
        }
    }

    #[test]
    fn relative_without_basis_is_ignored() {
        let mut t = Trajectory::default();
        t.push_sample(&sample(false, false, false, 10.0, 20.0), 1.0);
        assert!(!t.has_sample);
        assert!(t.to_sample().hide);
    }

    #[test]
    fn absolute_then_relative_accumulates() {
        let mut t = Trajectory::default();
        t.push_sample(&sample(true, false, false, 100.0, 50.0), 1.0);
        t.push_sample(&sample(false, false, false, 5.0, -2.0), 2.0);
        assert!(t.has_sample);
        // Relative deltas resolve against the prior knot basis immediately.
        assert!((t.basis_x - 105.0).abs() < 1e-3);
        assert!((t.basis_y - 48.0).abs() < 1e-3);
        // Broadcast pose blends toward the knot; finish the correction window.
        t.advance_to(2.0 + crate::game::constants::CORRECTION_MAX_MS as f64);
        assert!((t.x - 105.0).abs() < 1e-3);
        assert!((t.y - 48.0).abs() < 1e-3);
    }

    #[test]
    fn anchor_forces_absolute_even_when_absolute_false() {
        let mut t = Trajectory::default();
        // Would be ignored as relative without basis if anchor were not absolute.
        t.push_sample(&sample(false, true, false, 40.0, 60.0), 1.0);
        assert!(t.has_sample);
        assert!((t.x - 40.0).abs() < 1e-3);
        assert!((t.y - 60.0).abs() < 1e-3);
    }

    #[test]
    fn hide_clears_basis_so_relative_needs_absolute_again() {
        let mut t = Trajectory::default();
        t.push_sample(&sample(true, false, false, 10.0, 10.0), 1.0);
        t.push_sample(&sample(true, false, true, 0.0, 0.0), 2.0);
        assert!(!t.has_sample);
        assert!(t.hide);
        t.push_sample(&sample(false, false, false, 3.0, 3.0), 3.0);
        assert!(!t.has_sample);
        t.push_sample(&sample(true, false, false, 7.0, 8.0), 4.0);
        assert!(t.has_sample);
        assert!((t.x - 7.0).abs() < 1e-3);
        assert!((t.y - 8.0).abs() < 1e-3);
    }

    #[test]
    fn downlink_sample_is_always_absolute() {
        let mut t = Trajectory::default();
        t.push_sample(&sample(true, false, false, 1.0, 2.0), 1.0);
        let out = t.to_sample();
        assert!(out.absolute);
        assert!(!out.hide);
    }
}
