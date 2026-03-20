/**
 * Move ordering heuristics for compression optimization
 * 
 * Reorders legal moves so that commonly-played moves get smaller indices,
 * requiring fewer bits to encode. This is the core of the compression scheme:
 * by predicting which move is likely, we use fewer bits to identify it.
 * 
 * Priority order (most likely first):
 * 1. Promotions (most significant)
 * 2. Captures
 * 3. Checks/checkmates
 * 4. From/to squares (tiebreaker)
 */

import { ChessAdapter, Move } from "./adapter"

/**
 * Orders moves by likelihood to improve compression
 *
 * Creates a deterministic ordering where:
 * - Promotions come first (rare but high-impact)
 * - Captures come next (tactical moves)
 * - Checks/checkmates follow (aggressive moves)
 * - Square positions serve as final tiebreaker
 *
 * The encoder writes the index of the actual move in this ordered list,
 * using ceil(log2(legal_moves)) bits per move.
 * @param chess - Chess adapter with current position
 * @returns Ordered array of legal moves
 */
export function orderMoves(chess: ChessAdapter) {
  const moves = chess.moves()

  // Normalize square to numeric index (0-63) for consistent ordering
  // chess.js uses algebraic notation (e.g., "e4"), chessops uses numbers (e.g., 36)
  const normalizeSquare = (square: string | number): number => {
    if (typeof square === "number") return square
    // Convert algebraic notation to numeric index
    const file = square.charCodeAt(0) - 97 // 'a' -> 0, 'b' -> 1, etc.
    const rank = parseInt(square[1], 10) - 1 // '1' -> 0, '2' -> 1, etc.
    return rank * 8 + file
  }

  // Create sort key: captured + check + from + to + promotion
  // This ensures consistent ordering for the same position
  const getSortKey = (m: Move): string => {
    const promo = m.promotion || ""
    const captured = m.captured ? "1" : "0"
    const check = m.san.includes("+") || m.san.includes("#") ? "1" : "0"
    const from = normalizeSquare(m.from).toString().padStart(2, "0")
    const to = normalizeSquare(m.to).toString().padStart(2, "0")
    return captured + check + from + to + promo
  }

  // Sort with explicit priority checks first
  moves.sort((a, b) => {
    // Priority 1: Promotions first
    if (a.promotion && !b.promotion) return -1
    if (b.promotion && !a.promotion) return 1

    // Priority 2: Captures second
    if (a.captured && !b.captured) return -1
    if (b.captured && !a.captured) return 1

    // Priority 3: Checks third
    const ca = a.san.includes("+") || a.san.includes("#")
    const cb = b.san.includes("+") || b.san.includes("#")

    if (ca && !cb) return -1
    if (cb && !ca) return 1

    // Priority 4: Square-based tiebreaker for deterministic ordering
    return getSortKey(a).localeCompare(getSortKey(b))
  })

  return moves
}
