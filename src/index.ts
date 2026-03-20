/**
 * pgnpack - Ultra-compact PGN compression library
 * 
 * Encodes chess games into compact base64url strings using bit-level compression
 * and move ordering optimization. Supports both chess.js and chessops libraries.
 * 
 * Main exports:
 * - encodePGN/decodePGN: Auto-detect available chess library
 * - encodePGNWith/decodePGNWith: Use explicit chess adapter
 * - createChessAsync/createChessJsAdapter/createChessopsAdapter: Create adapters manually
 * - ChessAdapter/Move: Types for working with chess adapters directly
 */
export { encodePGN, encodePGNWith, type EncodeOptions } from "./encoder/encodePGN"
export { decodePGN, decodePGNWith } from "./decoder/decodePGN"
export { createChessAsync, createChessJsAdapter, createChessopsAdapter, type ChessAdapter, type Move } from "./chess/adapter"
export { CURRENT_VERSION, MIN_COMPATIBLE_VERSION } from "./constants"