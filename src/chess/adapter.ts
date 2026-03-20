/**
 * Chess library adapter - Unified interface for chess.js and chessops
 * 
 * Provides a consistent API for PGN manipulation regardless of which underlying
 * chess library is installed. Supports dynamic loading of either chessops (preferred)
 * or chess.js as a fallback.
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

async function tryCreateChessJsAdapter(): Promise<ChessAdapter | null> {
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

async function tryCreateChessopsAdapter(): Promise<ChessAdapter | null> {
  try {
    const chessopsChess = await import("chessops/chess")
    const { makeSanAndPlay, makeSan, parseSan } = await import("chessops/san")
    const { parsePgn, startingPosition } = await import("chessops/pgn")
    type NormalMove = { from: number; promotion?: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king"; to: number }

    let chess = chessopsChess.Chess.default()
    const moveHistory: Move[] = []

    function buildMoveMap(pos: typeof chess): Map<string, { from: number; to: number; promotion?: string }> {
      const moveMap = new Map<string, { from: number; to: number; promotion?: string }>()
      for (const [from, toDests] of pos.allDests()) {
        // Only pawns can promote - check if the moving piece is a pawn
        const piece = pos.board.get(from)
        const isPawn = piece?.role === 'pawn'
        
        for (const to of toDests) {
          const move = { from, to }
          try {
            const san = makeSan(pos, move as NormalMove)
            moveMap.set(san, move)
          } catch { }
          // Only add promotions for pawn moves that reach the promotion rank (rank 0 or 7)
          if (isPawn) {
            const toRank = Math.floor(to / 8)
            const isPromotionRank = toRank === 0 || toRank === 7
            if (isPromotionRank) {
              for (const promotion of ["knight", "bishop", "rook", "queen"]) {
                const promoMove = { from, to, promotion }
                try {
                  const san = makeSan(pos, promoMove as NormalMove)
                  moveMap.set(san, promoMove)
                } catch { }
              }
            }
          }
        }
      }
      return moveMap
    }

    function findMoveBySan(moveMap: Map<string, { from: number; to: number; promotion?: string }>, san: string, pos: typeof chess): { from: number; to: number; promotion?: string } | null {
      const exact = moveMap.get(san)
      if (exact) return exact

      const sanNoCheck = san.replace(/[+#]+$/, '')
      const noCheck = moveMap.get(sanNoCheck)
      if (noCheck) return noCheck

      if (san.endsWith('+')) {
        const withHash = sanNoCheck + '#'
        const match = moveMap.get(withHash)
        if (match) return match
      } else if (san.endsWith('#')) {
        const withPlus = sanNoCheck + '+'
        const match = moveMap.get(withPlus)
        if (match) return match
      }

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
        moveHistory.length = 0

        const games = parsePgn(pgn)
        for (const game of games) {
          const startPos = startingPosition(game.headers)
          if (startPos.isOk) {
            chess = startPos.unwrap()
          } else {
            chess = chessopsChess.Chess.default()
          }

          for (const node of game.moves.mainline()) {
            if (!node.san) continue

            let normalizedSan = node.san
              .replace(/0-0-0/g, "O-O-O")
              .replace(/0-0/g, "O-O")

            const parsed = parseSan(chess, normalizedSan)
            if (!parsed) {
              const moveMap = buildMoveMap(chess)
              const found = findMoveBySan(moveMap, normalizedSan, chess)
              if (found) {
                const promoToChar: Record<string, string> = { knight: "n", bishop: "b", rook: "r", queen: "q" }
                const canonicalSan = makeSan(chess, found as NormalMove)
                // Use SAN to detect captures (contains "x") - this handles castling correctly
                const captured = canonicalSan.includes("x")
                moveHistory.push({
                  san: canonicalSan,
                  from: found.from,
                  to: found.to,
                  promotion: found.promotion ? promoToChar[found.promotion] : undefined,
                  captured,
                })
                makeSanAndPlay(chess, found as NormalMove)
              }
            } else {
              const normalMove = parsed as NormalMove
              const promoToChar: Record<string, string> = { knight: "n", bishop: "b", rook: "r", queen: "q" }
              const canonicalSan = makeSan(chess, normalMove)
              // Use SAN to detect captures (contains "x") - this handles castling correctly
              const captured = canonicalSan.includes("x")
              moveHistory.push({
                san: canonicalSan,
                from: normalMove.from,
                to: normalMove.to,
                promotion: normalMove.promotion ? promoToChar[normalMove.promotion] : undefined,
                captured,
              })
              makeSanAndPlay(chess, normalMove)
            }
          }
          break
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
          // Use SAN to detect captures (contains "x") - this handles castling correctly
          const captured = san.includes("x")
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

        // Use SAN to detect captures (contains "x") - this handles castling correctly
        const captured = canonicalSan.includes("x")
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
