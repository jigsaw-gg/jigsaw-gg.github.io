//! Quarter-turn arithmetic for piece rotation (see `proto/game.proto`).

use crate::proto::game::v1::PieceState;

/// `turn(dx, dy, turns)` of the contract: clockwise quarter turns, y down.
pub fn turn_offset(dx: i32, dy: i32, turns: u32) -> (i32, i32) {
    match turns % 4 {
        0 => (dx, dy),
        1 => (dy.wrapping_neg(), dx),
        2 => (dx.wrapping_neg(), dy.wrapping_neg()),
        _ => (dy, dx.wrapping_neg()),
    }
}

/// Turn `members` about `pivot_piece_index`. Returns false and changes nothing
/// when the pivot is not on the board. Bumps each member's `rev`.
pub fn rotate_members(
    pieces: &mut [PieceState],
    members: &[u32],
    pivot_piece_index: u32,
    turns: u32,
) -> bool {
    let Some(pivot) = pieces.iter().find(|p| p.piece_index == pivot_piece_index) else {
        return false;
    };
    let (px, py) = (pivot.x_q, pivot.y_q);
    let turns = turns % 4;
    // Every piece has the same upright box and turns about its centre, so
    // turning the top-left offsets turns the centre offsets the same way.
    for piece in pieces
        .iter_mut()
        .filter(|p| members.contains(&p.piece_index))
    {
        let (ox, oy) = turn_offset(
            piece.x_q.wrapping_sub(px),
            piece.y_q.wrapping_sub(py),
            turns,
        );
        piece.x_q = px.wrapping_add(ox);
        piece.y_q = py.wrapping_add(oy);
        piece.rotation = (piece.rotation % 4 + turns) % 4;
        piece.rev = piece.rev.wrapping_add(1);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(piece_index: u32, x_q: i32, y_q: i32) -> PieceState {
        PieceState {
            piece_index,
            x_q,
            y_q,
            group_id: 0,
            rev: 1,
            rotation: 0,
        }
    }

    fn extent(pieces: &[PieceState]) -> (i32, i32) {
        let min_x = pieces.iter().map(|p| p.x_q).min().unwrap();
        let max_x = pieces.iter().map(|p| p.x_q).max().unwrap();
        let min_y = pieces.iter().map(|p| p.y_q).min().unwrap();
        let max_y = pieces.iter().map(|p| p.y_q).max().unwrap();
        (max_x - min_x, max_y - min_y)
    }

    #[test]
    fn turn_offset_matches_contract_table() {
        assert_eq!(turn_offset(3, 5, 0), (3, 5));
        assert_eq!(turn_offset(3, 5, 1), (-5, 3));
        assert_eq!(turn_offset(3, 5, 2), (-3, -5));
        assert_eq!(turn_offset(3, 5, 3), (5, -3));
        assert_eq!(turn_offset(3, 5, 4), (3, 5));
        assert_eq!(turn_offset(3, 5, 7), turn_offset(3, 5, 3));
    }

    #[test]
    fn group_turn_keeps_pivot_and_turns_offsets() {
        // L shape: pivot at (1000, 1000), one piece to the right, one below.
        let original = vec![
            piece(0, 1000, 1000),
            piece(1, 4200, 1000),
            piece(2, 1000, 3560),
        ];
        let mut pieces = original.clone();
        assert!(rotate_members(&mut pieces, &[0, 1, 2], 0, 1));

        assert_eq!((pieces[0].x_q, pieces[0].y_q), (1000, 1000));
        for (after, before) in pieces.iter().zip(&original) {
            let (ox, oy) = turn_offset(before.x_q - 1000, before.y_q - 1000, 1);
            assert_eq!((after.x_q, after.y_q), (1000 + ox, 1000 + oy));
            assert_eq!(after.rotation, 1);
            assert_eq!(after.rev, 2);
        }

        let (w, h) = extent(&original);
        assert_eq!(extent(&pieces), (h, w));
    }

    #[test]
    fn four_turns_restore_every_position() {
        let original = vec![
            piece(0, -317, 911),
            piece(1, 2883, 911),
            piece(2, 2883, 3471),
            piece(3, 77, 77),
        ];
        let mut pieces = original.clone();
        for _ in 0..4 {
            assert!(rotate_members(&mut pieces, &[0, 1, 2], 1, 1));
        }
        for (after, before) in pieces.iter().take(3).zip(&original) {
            assert_eq!((after.x_q, after.y_q), (before.x_q, before.y_q));
            assert_eq!(after.rotation, 0);
            assert_eq!(after.rev, 5);
        }
        // Not a member: untouched.
        assert_eq!(pieces[3], original[3]);
    }

    #[test]
    fn missing_pivot_changes_nothing() {
        let original = vec![piece(0, 10, 20), piece(1, 30, 40)];
        let mut pieces = original.clone();
        assert!(!rotate_members(&mut pieces, &[0, 1], 9, 1));
        assert_eq!(pieces, original);
    }
}
