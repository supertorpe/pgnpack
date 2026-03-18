/**
 * Chess library adapter - Unified interface for chess.js and chessops
 * 
 * Provides a consistent API for PGN manipulation regardless of which underlying
 * chess library is installed. Supports dynamic loading of either chess.js (preferred)
 * or chessops as a fallback.
 * 
 * The adapter handles:
 * - Loading PGN strings and parsing move history
 * - Generating legal moves for a position
 * - Making moves via Standard Algebraic Notation (SAN)
 * - Resetting to initial position
 * 
 * Both chess.js and chessops have quirks that require special handling,
 * particularly around PGN parsing and move conversion.
 */

import { existsSync } from "fs"
import { resolve } from "path"

// Unified move representation across both libraries
export interface Move {
  san: string           // Standard Algebraic Notation (e.g., "e4", "Nf3", "O-O")
  from: string | number // Origin square (0-63 for chessops, algebraic for chess.js)
  to: string | number   // Destination square
  promotion?: string    // Promotion piece (n, b, r, q)
  captured?: boolean    // Whether this move captures a piece
}

// Abstract interface that both libraries implement
export interface ChessAdapter {
  loadPgn(pgn: string): void     // Load a PGN string into the position
  history(): Move[]              // Get move history from current position
  reset(): void                  // Reset to starting position
  moves(): Move[]                // Get all legal moves from current position
  move(san: string): Move | null // Make a move and return the move object
}

// Global cache for auto-detected adapter
let cachedChess: ChessAdapter | null = null
let initPromise: Promise<ChessAdapter> | null = null

/**
 * Checks if a package is installed by looking in node_modules
 * @param name - Package name to check
 * @returns true if the package is available
 */
function isLibraryAvailable(name: string): boolean {
  try {
    const path = resolve(process.cwd(), "node_modules", name)
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * Creates a chess.js adapter if the library is available
 * 
 * chess.js provides a straightforward API and is the preferred library.
 * The adapter wraps its synchronous methods in the async ChessAdapter interface.
 * @returns ChessAdapter or null if chess.js is not installed
 */
async function tryCreateChessJsAdapter(): Promise<ChessAdapter | null> {
  if (!isLibraryAvailable("chess.js")) return null
  try {
    const { Chess } = await import("chess.js")
    let chess = new Chess()

    return {
      loadPgn(pgn: string): void {
        chess.loadPgn(pgn)
      },

      history(): Move[] {
        return chess.history({ verbose: true }) as Move[]
      },

      reset(): void {
        chess.reset()
      },

      moves(): Move[] {
        return chess.moves({ verbose: true }) as Move[]
      },

      move(san: string): Move | null {
        return chess.move(san) as Move | null
      },
    }
  } catch {
    return null
  }
}

/**
 * Creates a chessops adapter if the library is available
 * 
 * chessops is a more lightweight library but has a more complex API.
 * Key challenges:
 * - No built-in PGN parser, requires manual parsing with chessops/pgn
 * - move() doesn't support SAN directly, needs makeSanAndPlay from chessops/san
 * - Promotions require special handling (only valid for pawn promotions)
 * - Position uses 0-63 square indices instead of algebraic notation
 * 
 * The adapter implements custom SAN parsing to handle disambiguation
 * (e.g., "Qdc1" vs "Qxc1") and promotion notation.
 * @returns ChessAdapter or null if chessops is not installed
 */
async function tryCreateChessopsAdapter(): Promise<ChessAdapter | null> {
  if (!isLibraryAvailable("chessops")) return null
  try {
    const chessopsChess = await import("chessops/chess")
    const { makeSanAndPlay, makeSan } = await import("chessops/san")
    // NormalMove is the type expected by chessops/san functions
    type NormalMove = { from: number; promotion?: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king"; to: number }

    let chess = chessopsChess.Chess.default()
    const moveHistory: Move[] = []

    /**
     * Extracts moves from PGN using regex (more reliable than chessops parsePgn)
     */
    function extractMovesFromPgn(pgn: string): string[] {
      const moves: string[] = []
      const cleaned = pgn.replace(/\([^)]*\)/g, "").replace(/\{[^}]*\}/g, "")
      const moveRegex = /(?:(\d+)\.\s*)?([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*)\s*/g
      let match
      while ((match = moveRegex.exec(cleaned)) !== null) {
        if (match[2]) {
          // Normalize castling notation: convert 0-0 to O-O for consistency with chessops
          let san = match[2].replace(/0-0-0/g, "O-O-O").replace(/0-0/g, "O-O")
          moves.push(san)
        }
      }
      return moves
    }

    /**
     * Builds a mapping from SAN to move objects for the current position
     * This allows O(1) lookup of moves by their SAN representation
     */
    function buildMoveMap(pos: typeof chess): Map<string, { from: number; to: number; promotion?: string }> {
      const moveMap = new Map<string, { from: number; to: number; promotion?: string }>()
      for (const [from, toDests] of pos.allDests()) {
        for (const to of toDests) {
          const move = { from, to }
          try {
            // Try to generate SAN for this move
            const san = makeSan(pos, move as NormalMove)
            moveMap.set(san, move)
          } catch {
            // Invalid move (e.g., not a legal move), skip
          }
          // Also handle promotion moves
          for (const promotion of ["knight", "bishop", "rook", "queen"]) {
            const promoMove = { from, to, promotion }
            try {
              const san = makeSan(pos, promoMove as NormalMove)
              moveMap.set(san, promoMove)
            } catch {
              // Invalid promotion (e.g., promoting a non-pawn), skip
            }
          }
        }
      }
      return moveMap
    }

    /**
     * Finds a move by its SAN representation with fallback parsing
     * 
     * chessops doesn't handle all SAN variants natively, so this implements
     * custom parsing for cases like:
     * - Disambiguation: Qdc1 (queen from d-file to c1)
     * - Captures: exd5 (pawn from e-file captures on d5)
     * - Promotions: e8=Q
     * - Check/checkmate indicators: Qc1+ vs Qc1#
     * 
     * First tries exact match from moveMap, then falls back to regex parsing
     */
    function findMoveBySan(moveMap: Map<string, { from: number; to: number; promotion?: string }>, san: string, pos: typeof chess): { from: number; to: number; promotion?: string } | null {
      // First try exact match from pre-built map
      const exact = moveMap.get(san)
      if (exact) return exact

      // Try without check indicators (+, #) - chess.js may use + where chessops uses #
      const sanNoCheck = san.replace(/[+#]+$/, '')
      const noCheck = moveMap.get(sanNoCheck)
      if (noCheck) return noCheck

      // Try swapping + and #
      if (san.endsWith('+')) {
        const withHash = sanNoCheck + '#'
        const match = moveMap.get(withHash)
        if (match) return match
      } else if (san.endsWith('#')) {
        const withPlus = sanNoCheck + '+'
        const match = moveMap.get(withPlus)
        if (match) return match
      }

      // Try to find a move that matches by piece type and destination
      const sanMatch = san.match(/^([KQRBNP]?)([a-h]?[1-8]?x?)?([a-h][1-8])(?:\=([KQRBNP]))?[+#]*$/)
      if (!sanMatch) return null

      const [, pieceType, , destSquare, promotion] = sanMatch
      const piece = pieceType || 'P'
      const pieceMap: Record<string, string> = { K: 'k', Q: 'q', R: 'r', B: 'b', N: 'n', P: 'p' }
      const targetType = pieceMap[piece]

      const candidates: Array<{ from: number; to: number; promotion?: string; generatedSan: string }> = []
      for (const [generatedSan, move] of moveMap) {
        const moveDest = move.to
        const movePromotion = move.promotion

        if (moveDest !== parseInt(destSquare.replace(/([a-h])([1-8])/, (_, f, r) => {
          return ((parseInt(r) - 1) * 8 + (f.charCodeAt(0) - 97)).toString()
        }))) continue

        if (promotion && movePromotion !== promotion.toLowerCase()) continue

        if (targetType !== 'p') {
          const pieceOnSquare = pos.board.get(move.from)
          const roleMap: Record<string, string> = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }
          const pieceRole = pieceOnSquare ? roleMap[pieceOnSquare.role] || pieceOnSquare.role : null
          if (!pieceOnSquare || pieceRole !== targetType) continue
        }

        candidates.push({ from: move.from, to: move.to, promotion: move.promotion, generatedSan })
      }

      if (candidates.length === 1) return candidates[0]

      if (candidates.length > 1) {
        const sanFile = sanMatch[2]?.match(/[a-h]/)?.[0]
        const sanRank = sanMatch[2]?.match(/[1-8]/)?.[0]

        for (const cand of candidates) {
          const candFile = String.fromCharCode(97 + (cand.from % 8))
          const candRank = String(Math.floor(cand.from / 8) + 1)

          if (sanFile && candFile !== sanFile) continue
          if (sanRank && candRank !== sanRank) continue

          return cand
        }
      }

      return null
    }

    return {
      loadPgn(pgn: string): void {
        chess = chessopsChess.Chess.default()
        moveHistory.length = 0
        // Use regex-based extraction (more reliable than parsePgn)
        const sanList = extractMovesFromPgn(pgn)
        for (const san of sanList) {
          const moveMap = buildMoveMap(chess)
          const found = findMoveBySan(moveMap, san, chess)
          if (found) {
            const captured = chess.board.get(found.to) !== undefined
            const promoToChar: Record<string, string> = { knight: "n", bishop: "b", rook: "r", queen: "q" }
            moveHistory.push({
              san,
              from: found.from,
              to: found.to,
              promotion: found.promotion ? promoToChar[found.promotion] : undefined,
              captured,
            })
            makeSanAndPlay(chess, found as NormalMove)
          } else {
            // Skip move silently - this can happen with complex disambiguation cases
          }
        }
      },

      history(): Move[] {
        return [...moveHistory]
      },

      reset(): void {
        chess = chessopsChess.Chess.default()
        moveHistory.length = 0
      },

      moves(): Move[] {
        const moveMap = buildMoveMap(chess)
        const result: Move[] = []
        for (const [san, move] of moveMap) {
          const captured = chess.board.get(move.to) !== undefined
          const promoToChar: Record<string, string> = { knight: "n", bishop: "b", rook: "r", queen: "q" }
          result.push({
            san,
            from: move.from,
            to: move.to,
            promotion: move.promotion ? promoToChar[move.promotion] : undefined,
            captured,
          })
        }
        return result
      },

      move(san: string): Move | null {
        const moveMap = buildMoveMap(chess)
        const found = findMoveBySan(moveMap, san, chess)
        if (!found) return null
        
        // Generate canonical SAN using makeSan (same as moves() uses)
        const canonicalSan = makeSan(chess, found as NormalMove)
        
        const captured = chess.board.get(found.to) !== undefined
        const promoToChar: Record<string, string> = { knight: "n", bishop: "b", rook: "r", queen: "q" }
        const result: Move = {
          san: canonicalSan,
          from: found.from,
          to: found.to,
          promotion: found.promotion ? promoToChar[found.promotion] : undefined,
          captured,
        }
        makeSanAndPlay(chess, found as NormalMove)
        return result
      },
    }
  } catch {
    return null
  }
}

export async function createChessJsAdapter(): Promise<ChessAdapter> {
  const adapter = await tryCreateChessJsAdapter()
  if (!adapter) {
    throw new Error("chess.js is not available. Please install it: npm install chess.js")
  }
  return adapter
}

export async function createChessopsAdapter(): Promise<ChessAdapter> {
  const adapter = await tryCreateChessopsAdapter()
  if (!adapter) {
    throw new Error("chessops is not available. Please install it: npm install chessops")
  }
  return adapter
}

export async function createChessAsync(): Promise<ChessAdapter> {
  if (cachedChess) return cachedChess
  if (initPromise) return initPromise

  initPromise = (async () => {
    // Prefer chessops over chess.js
    const opsAdapter = await tryCreateChessopsAdapter()
    if (opsAdapter) {
      cachedChess = opsAdapter
      return opsAdapter
    }

    const jsAdapter = await tryCreateChessJsAdapter()
    if (jsAdapter) {
      cachedChess = jsAdapter
      return jsAdapter
    }

    throw new Error(
      `Neither chess.js nor chessops is available. Please install one of them.\n- chess.js: npm install chess.js\n- chessops: npm install chessops`
    )
  })()

  return initPromise
}

export async function withChess<T>(fn: (chess: ChessAdapter) => T): Promise<T> {
  const chess = await createChessAsync()
  return fn(chess)
}
