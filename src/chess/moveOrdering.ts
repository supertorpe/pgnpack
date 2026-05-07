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
 * 3. From/to squares (tiebreaker)
 *
 * IMPORTANT: This function MUST produce identical ordering regardless of the
 * input order from the chess library. We use SAN-based sorting which is
 * consistent across both chess.js and chessops.
 */

import { ChessAdapter, Move } from "./adapter"

/**
 * Orders moves by likelihood to improve compression
 *
 * Creates a deterministic ordering where:
 * - Promotions come first (rare but high-impact)
 * - Captures come next (tactical moves)
 * - SAN string serves as final tiebreaker (deterministic across libraries)
 *
 * The encoder writes the index of the actual move in this ordered list,
 * using ceil(log2(legal_moves)) bits per move.
 * @param chess - Chess adapter with current position
 * @returns Ordered array of legal moves
 */
export function orderMoves(chess: ChessAdapter) {
  const moves = chess.moves()

  // Create a FULLY deterministic sort key based on SAN
  // SAN is consistent across both chess.js and chessops
  const getSortKey = (m: Move): string => {
    // Priority flags: promotions (2), captures (1)
    const isPromo = m.promotion ? "2" : "0"
    const isCapture = m.captured ? "1" : "0"
    // Use SAN as the ultimate tiebreaker - it's consistent across libraries
    // Pad to ensure proper string sorting
    const san = m.san.padEnd(10, " ")
    // Combine into single key: priority + SAN
    return isPromo + isCapture + san
  }

  // Sort using ONLY the deterministic key - no library-dependent ordering
  moves.sort((a, b) => {
    return getSortKey(a).localeCompare(getSortKey(b))
  })

  return moves
}
