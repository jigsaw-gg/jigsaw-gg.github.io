//! Port of client `chooseGrid` / deterministic initial scatter.

use crate::game::constants::{
    MAX_PIECE_COUNT, MOTION_Q, RESERVE_RATIO, ROTATION_SALT, SCATTER_SALT, SLOT_GAP, SLOT_JITTER,
};
use crate::proto::game::v1::{BoardSnapshot, PieceState, PuzzleSetup};

pub fn choose_grid(piece_count: u32, image_width: u32, image_height: u32) -> (u32, u32) {
    let count = piece_count as i32;
    if count < 1 || image_width == 0 || image_height == 0 {
        return (1, 1);
    }

    let iw = image_width as f64;
    let ih = image_height as f64;
    let side = ((iw * ih) / count as f64).sqrt();
    let ideal_cols = iw / side;
    let ideal_rows = ih / side;
    let col_band = axis_band(ideal_cols);
    let row_band = axis_band(ideal_rows);

    let mut best_cols = col_band.rounded;
    let mut best_rows = row_band.rounded;
    let mut best_key = grid_key(best_cols, best_rows, iw, ih, count, ideal_cols, ideal_rows);

    for rows in row_band.lo..=row_band.hi {
        for cols in col_band.lo..=col_band.hi {
            let key = grid_key(cols, rows, iw, ih, count, ideal_cols, ideal_rows);
            if better_grid(&key, &best_key) {
                best_cols = cols;
                best_rows = rows;
                best_key = key;
            }
        }
    }

    (best_cols as u32, best_rows as u32)
}

struct AxisBand {
    lo: i32,
    hi: i32,
    rounded: i32,
}

fn axis_band(ideal: f64) -> AxisBand {
    if !ideal.is_finite() || ideal < 1.0 {
        return AxisBand {
            lo: 1,
            hi: 1,
            rounded: 1,
        };
    }
    AxisBand {
        lo: (ideal.floor() as i32 - 1).max(1),
        hi: ideal.ceil() as i32 + 1,
        rounded: (ideal.round() as i32).max(1),
    }
}

fn grid_key(
    cols: i32,
    rows: i32,
    image_width: f64,
    image_height: f64,
    count: i32,
    ideal_cols: f64,
    ideal_rows: f64,
) -> [f64; 6] {
    let piece_width = image_width / cols as f64;
    let piece_height = image_height / rows as f64;
    let ratio = piece_width / piece_height;
    let stretch = if ratio >= 1.0 { ratio } else { 1.0 / ratio };
    let count_gap = ((cols * rows) - count).abs() as f64;
    let drift = (cols as f64 - ideal_cols).abs() + (rows as f64 - ideal_rows).abs();
    let across = image_width >= image_height;
    let turned = if across { cols < rows } else { rows < cols };
    [
        stretch,
        count_gap,
        drift,
        if turned { 1.0 } else { 0.0 },
        rows as f64,
        cols as f64,
    ]
}

fn better_grid(next: &[f64; 6], best: &[f64; 6]) -> bool {
    for i in 0..6 {
        let candidate = next[i];
        let current = best[i];
        if candidate < current - 1e-9 {
            return true;
        }
        if current < candidate - 1e-9 {
            return false;
        }
    }
    false
}

pub fn validate_setup(setup: &PuzzleSetup) -> Result<(), String> {
    if setup.image_url.is_empty() {
        return Err("image_url required".into());
    }
    if setup.image_width == 0 || setup.image_height == 0 {
        return Err("image dimensions must be positive".into());
    }
    if setup.piece_count == 0 || setup.piece_count > MAX_PIECE_COUNT {
        return Err(format!(
            "piece_count must be 1..={MAX_PIECE_COUNT}, got {}",
            setup.piece_count
        ));
    }
    Ok(())
}

pub fn setups_equivalent(a: &PuzzleSetup, b: &PuzzleSetup) -> bool {
    a.image_url == b.image_url
        && a.image_width == b.image_width
        && a.image_height == b.image_height
        && a.piece_count == b.piece_count
        && a.seed == b.seed
        && a.rotation_enabled == b.rotation_enabled
}

fn mix_seed(seed: u32, salt: u32) -> u32 {
    let mixed = seed.wrapping_mul(0x9e3779b1) ^ salt;
    if mixed == 0 { 1 } else { mixed }
}

fn mulberry32(seed: u32) -> impl FnMut() -> f32 {
    let mut state = if seed == 0 { 0x6d2b79f5 } else { seed };
    move || {
        state = state.wrapping_add(0x6d2b79f5);
        let mut t = (state ^ (state >> 15)).wrapping_mul(1 | state);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        ((t ^ (t >> 14)) as f32) / 4294967296.0
    }
}

fn quantize(px: f32) -> i32 {
    (px * MOTION_Q as f32).round() as i32
}

/// Deterministic initial board (simplified port of client `scatterPieces`).
pub fn initial_board(setup: &PuzzleSetup, cols: u32, rows: u32) -> BoardSnapshot {
    let n = (cols * rows) as usize;
    let cell_w = setup.image_width as f32 / cols as f32;
    let cell_h = setup.image_height as f32 / rows as f32;
    let gap_x = cell_w * SLOT_GAP;
    let gap_y = cell_h * SLOT_GAP;
    let pad = 8.0_f32;
    let margin_x = pad + cell_w * (SLOT_JITTER / 2.0);
    let margin_y = pad + cell_h * (SLOT_JITTER / 2.0);

    let image_area = (cols as f32 * cell_w * rows as f32 * cell_h).max(1.0);
    let reserve_w = (image_area * RESERVE_RATIO).sqrt();
    let reserve_h = reserve_w / RESERVE_RATIO;

    let mut rng = mulberry32(mix_seed(setup.seed, SCATTER_SALT));
    let slots = slots_around_reserve(n, reserve_w, reserve_h, cell_w, cell_h, gap_x, gap_y);

    let mut min_x = -reserve_w / 2.0;
    let mut min_y = -reserve_h / 2.0;
    let mut max_x = reserve_w / 2.0;
    let mut max_y = reserve_h / 2.0;
    for slot in &slots {
        min_x = min_x.min(slot.0);
        min_y = min_y.min(slot.1);
        max_x = max_x.max(slot.0 + cell_w);
        max_y = max_y.max(slot.1 + cell_h);
    }
    let shift_x = margin_x - min_x;
    let shift_y = margin_y - min_y;

    let mut order: Vec<u32> = (0..n as u32).collect();
    for i in (1..order.len()).rev() {
        let j = (rng() * (i as f32 + 1.0)).floor() as usize;
        order.swap(i, j.min(i));
    }
    if order.len() > 1 && order.iter().enumerate().all(|(i, &id)| id == i as u32) {
        order.swap(0, 1);
    }

    // A separate stream keeps the scatter sequence, and so every position,
    // identical to a game without rotation.
    let mut turn_rng = mulberry32(mix_seed(setup.seed, ROTATION_SALT));
    let mut pieces = Vec::with_capacity(n);
    for piece_index in 0..n as u32 {
        let slot_i = order.iter().position(|&id| id == piece_index).unwrap_or(0);
        let (sx, sy) = slots.get(slot_i).copied().unwrap_or((0.0, 0.0));
        let jitter_x = (rng() - 0.5) * cell_w * SLOT_JITTER;
        let jitter_y = (rng() - 0.5) * cell_h * SLOT_JITTER;
        pieces.push(PieceState {
            piece_index,
            x_q: quantize(sx + shift_x + jitter_x),
            y_q: quantize(sy + shift_y + jitter_y),
            group_id: piece_index,
            rev: 1,
            rotation: if setup.rotation_enabled {
                ((turn_rng() * 4.0).floor() as u32).min(3)
            } else {
                0
            },
        });
    }

    BoardSnapshot {
        board_rev: 1,
        pieces,
    }
}

fn place(slots: &mut Vec<(f32, f32)>, count: usize, x: f32, y: f32) -> bool {
    if slots.len() >= count {
        return false;
    }
    slots.push((x, y));
    slots.len() < count
}

fn center_out(xs: &[f32]) -> Vec<f32> {
    if xs.is_empty() {
        return Vec::new();
    }
    let mid = xs.len() / 2;
    let mut out = Vec::with_capacity(xs.len());
    out.push(xs[mid]);
    for d in 1..=xs.len() {
        if mid >= d {
            out.push(xs[mid - d]);
        }
        if mid + d < xs.len() {
            out.push(xs[mid + d]);
        }
        if out.len() >= xs.len() {
            break;
        }
    }
    out.truncate(xs.len());
    out
}

fn slots_around_reserve(
    count: usize,
    reserve_w: f32,
    reserve_h: f32,
    cell_w: f32,
    cell_h: f32,
    gap_x: f32,
    gap_y: f32,
) -> Vec<(f32, f32)> {
    let mut slots = Vec::with_capacity(count);
    if count == 0 {
        return slots;
    }

    let slot_w = cell_w + gap_x;
    let slot_h = cell_h + gap_y;
    let inset_x = reserve_w / 2.0 + gap_x;
    let inset_y = reserve_h / 2.0 + gap_y;
    let left_x = -inset_x - cell_w;
    let right_x = inset_x;
    let top_y = -inset_y - cell_h;
    let bottom_y = inset_y;
    let span_w = right_x + cell_w - left_x;
    let count_x = ((span_w + gap_x) / slot_w).floor().max(2.0) as usize;
    let extra_x = (span_w - (count_x as f32 * cell_w + (count_x as f32 - 1.0) * gap_x)).max(0.0);
    let pitch_x = cell_w + gap_x + extra_x / (count_x as f32 - 1.0).max(1.0);
    let mut xs: Vec<f32> = (0..count_x).map(|i| left_x + i as f32 * pitch_x).collect();

    let side_top = top_y + cell_h + gap_y;
    let side_span = bottom_y - gap_y - side_top;
    let count_y = ((side_span + gap_y) / slot_h).floor().max(0.0) as usize;
    let mut ys = vec![top_y];
    if count_y > 0 {
        let extra_y =
            (side_span - (count_y as f32 * cell_h + (count_y as f32 - 1.0) * gap_y)).max(0.0);
        let pitch_y = if count_y == 1 {
            0.0
        } else {
            cell_h + gap_y + extra_y / (count_y as f32 - 1.0)
        };
        let offset_y = if count_y == 1 { extra_y / 2.0 } else { 0.0 };
        for i in 0..count_y {
            ys.push(side_top + offset_y + i as f32 * pitch_y);
        }
    }
    ys.push(bottom_y);

    // Top row L→R, bottom R→L, then sides.
    for &x in &xs {
        if !place(&mut slots, count, x, top_y) {
            return slots;
        }
    }
    for &x in xs.iter().rev() {
        if !place(&mut slots, count, x, bottom_y) {
            return slots;
        }
    }
    for &y in ys.iter().take(ys.len().saturating_sub(1)).skip(1).rev() {
        if !place(&mut slots, count, right_x, y) {
            return slots;
        }
    }
    for &y in ys.iter().take(ys.len().saturating_sub(1)).skip(1) {
        if !place(&mut slots, count, left_x, y) {
            return slots;
        }
    }

    for _guard in 0..=count {
        if slots.len() >= count {
            break;
        }
        let outer_left = xs[0] - (cell_w + gap_x);
        let outer_right = xs[xs.len() - 1] + (cell_w + gap_x);
        for &y in &ys {
            if !place(&mut slots, count, outer_left, y) {
                return slots;
            }
            if !place(&mut slots, count, outer_right, y) {
                return slots;
            }
        }
        xs = {
            let mut next = vec![outer_left];
            next.extend_from_slice(&xs);
            next.push(outer_right);
            next
        };
        let above_y = ys[0] - (cell_h + gap_y);
        for &x in &center_out(&xs) {
            if !place(&mut slots, count, x, above_y) {
                return slots;
            }
        }
        ys.insert(0, above_y);
        let below_y = ys[ys.len() - 1] + (cell_h + gap_y);
        for &x in &center_out(&xs) {
            if !place(&mut slots, count, x, below_y) {
                return slots;
            }
        }
        ys.push(below_y);
    }

    slots
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use prost::Message;

    use super::*;

    fn setup(rotation_enabled: bool) -> PuzzleSetup {
        PuzzleSetup {
            image_url: "https://example.test/p.png".into(),
            image_width: 600,
            image_height: 500,
            piece_count: 30,
            seed: 42,
            rotation_enabled,
        }
    }

    #[test]
    fn rotation_off_deals_upright_pieces() {
        let board = initial_board(&setup(false), 6, 5);
        assert_eq!(board.pieces.len(), 30);
        assert!(board.pieces.iter().all(|p| p.rotation == 0));
    }

    #[test]
    fn rotation_on_deals_seeded_orientations_at_same_positions() {
        let plain = initial_board(&setup(false), 6, 5);
        let turned = initial_board(&setup(true), 6, 5);
        assert!(turned.pieces.iter().all(|p| p.rotation < 4));
        let distinct: HashSet<u32> = turned.pieces.iter().map(|p| p.rotation).collect();
        assert!(distinct.len() > 1);
        for (a, b) in plain.pieces.iter().zip(&turned.pieces) {
            assert_eq!(
                (a.piece_index, a.x_q, a.y_q, a.group_id, a.rev),
                (b.piece_index, b.x_q, b.y_q, b.group_id, b.rev)
            );
        }
        assert_eq!(initial_board(&setup(true), 6, 5), turned);
    }

    #[test]
    fn setups_differing_in_rotation_are_not_equivalent() {
        assert!(setups_equivalent(&setup(true), &setup(true)));
        assert!(!setups_equivalent(&setup(false), &setup(true)));
    }

    #[test]
    fn json_round_trips_rotation_fields() {
        let json = serde_json::to_value(setup(true)).unwrap();
        assert_eq!(json["rotationEnabled"], true);
        let back: PuzzleSetup = serde_json::from_value(json).unwrap();
        assert!(back.rotation_enabled);

        let piece = PieceState {
            piece_index: 3,
            x_q: 10,
            y_q: 20,
            group_id: 3,
            rev: 1,
            rotation: 2,
        };
        let json = serde_json::to_value(piece).unwrap();
        assert_eq!(json["rotation"], 2);
        let back: PieceState = serde_json::from_value(json).unwrap();
        assert_eq!(back, piece);
    }

    #[test]
    fn json_without_rotation_fields_decodes_to_defaults() {
        let setup: PuzzleSetup = serde_json::from_str(
            r#"{"imageUrl":"u","imageWidth":600,"imageHeight":500,"pieceCount":30,"seed":1}"#,
        )
        .unwrap();
        assert!(!setup.rotation_enabled);
        let piece: PieceState =
            serde_json::from_str(r#"{"pieceIndex":4,"xQ":1,"yQ":2,"groupId":4,"rev":1}"#).unwrap();
        assert_eq!(piece.rotation, 0);
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    struct LegacyPuzzleSetup {
        #[prost(string, tag = "1")]
        image_url: String,
        #[prost(uint32, tag = "2")]
        image_width: u32,
        #[prost(uint32, tag = "3")]
        image_height: u32,
        #[prost(uint32, tag = "4")]
        piece_count: u32,
        #[prost(uint32, tag = "5")]
        seed: u32,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    struct LegacyPieceState {
        #[prost(uint32, tag = "1")]
        piece_index: u32,
        #[prost(int32, tag = "2")]
        x_q: i32,
        #[prost(int32, tag = "3")]
        y_q: i32,
        #[prost(uint32, tag = "4")]
        group_id: u32,
        #[prost(uint32, tag = "5")]
        rev: u32,
    }

    #[test]
    fn legacy_protobuf_decodes_to_defaults() {
        let bytes = LegacyPuzzleSetup {
            image_url: "u".into(),
            image_width: 600,
            image_height: 500,
            piece_count: 30,
            seed: 9,
        }
        .encode_to_vec();
        let setup = PuzzleSetup::decode(bytes.as_slice()).unwrap();
        assert_eq!(setup.seed, 9);
        assert!(!setup.rotation_enabled);

        let bytes = LegacyPieceState {
            piece_index: 5,
            x_q: -7,
            y_q: 8,
            group_id: 5,
            rev: 3,
        }
        .encode_to_vec();
        let piece = PieceState::decode(bytes.as_slice()).unwrap();
        assert_eq!((piece.piece_index, piece.x_q, piece.rev), (5, -7, 3));
        assert_eq!(piece.rotation, 0);
    }
}
