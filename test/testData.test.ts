import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { Chess } from "chess.js"
import { encodePGNWith, decodePGNWith, createChessJsAdapter, createChessopsAdapter } from "../src"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = join(__dirname, "data")

interface ParsedMove {
  san: string
  clk: number
  eval: number
}

function parseMoves(content: string): ParsedMove[] {
  const moves: ParsedMove[] = []

  const headerEnd = content.indexOf("\n\n")
  const movesContent = headerEnd > 0 ? content.substring(headerEnd) : content

  let cleaned = movesContent.replace(/\([^)]*\)/g, "").replace(/\{[^}]*\}/g, "")

  const chess = new Chess()

  const moveRegex = /(?:\{[^}]*\})?\s*(?:(\d+)\.\s*)?([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[\+#]?|O-O-O?|O-O)\s*(?:\{([^}]*)\})?/g

  const clkRegex = /\[%clk (\d+):(\d+):(\d+)\]/
  const evalRegex = /\[%eval ([+-]?\d+(?:\.\d+)?)\]/

  let lastClk = 0

  let match
  while ((match = moveRegex.exec(cleaned)) !== null) {
    const san = match[2]
    const comment = match[3] || ""

    if (!san) continue

    const move = chess.move(san)
    if (!move) continue

    let clk = lastClk
    let eval_ = 0

    const clkMatch = clkRegex.exec(comment)
    if (clkMatch) {
      const hours = parseInt(clkMatch[1])
      const minutes = parseInt(clkMatch[2])
      const seconds = parseInt(clkMatch[3])
      clk = hours * 3600 + minutes * 60 + seconds
      lastClk = clk
    }

    const evalMatch = evalRegex.exec(comment)
    if (evalMatch) {
      eval_ = Math.round(parseFloat(evalMatch[1]) * 100)
    }

    moves.push({ san: move.san, clk, eval: eval_ })
  }

  return moves
}

function parsePgnMoves(content: string): string[] {
  const chess = new Chess()

  let cleaned = content.replace(/\([^)]*\)/g, "").replace(/\{[^}]*\}/g, "")

  try {
    chess.loadPgn(cleaned)
    return chess.history()
  } catch {
    return []
  }
}

function splitPgnGames(content: string): string[] {
  const games: string[] = []
  const lines = content.split("\n")
  let currentGame: string[] = []
  let foundFirstEvent = false

  for (const line of lines) {
    if (line.trim().startsWith("[Event")) {
      if (foundFirstEvent && currentGame.length > 0) {
        games.push(currentGame.join("\n"))
        currentGame = []
      }
      foundFirstEvent = true
    }
    currentGame.push(line)
  }

  if (currentGame.length > 0) {
    games.push(currentGame.join("\n"))
  }

  return games
}

function getGameHistory(pgn: string): string[] {
  return parsePgnMoves(pgn)
}

describe("Test data files", () => {
  const libraries = [
    { name: "chess.js", createAdapter: createChessJsAdapter },
    { name: "chessops", createAdapter: createChessopsAdapter },
  ]

  for (const lib of libraries) {
    describe(`with ${lib.name}`, () => {
      let chess: Awaited<ReturnType<typeof lib.createAdapter>>

      beforeAll(async () => {
        chess = await lib.createAdapter()
      })

      it("encodes and decodes all PGN files", { timeout: 300000 }, async () => {
        const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".pgn"))

        let totalGames = 0
        let encodeTime = 0
        let decodeTime = 0

        for (const file of files) {
          const content = readFileSync(join(DATA_DIR, file), "utf-8")
          const games = splitPgnGames(content)

          for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
            const game = games[gameIndex]
            const originalHistory = getGameHistory(game)
            if (originalHistory.length === 0) continue

            const encodeStart = performance.now()
            const encoded = await encodePGNWith(chess, game)
            encodeTime += performance.now() - encodeStart

            const decodeStart = performance.now()
            const decoded = await decodePGNWith(chess, encoded)
            decodeTime += performance.now() - decodeStart

            totalGames++

            const decodedHistory = getGameHistory(decoded)

            expect(decodedHistory.length, `File: ${file}, game ${gameIndex}: expected ${originalHistory.length} moves, got ${decodedHistory.length}`).toBe(originalHistory.length)
            for (let i = 0; i < originalHistory.length; i++) {
              expect(decodedHistory[i], `File: ${file}, game ${gameIndex}, move ${i}`).toBe(originalHistory[i])
            }
          }
        }

        console.log(`[${lib.name}] Encoded ${totalGames} games in ${(encodeTime / 1000).toFixed(2)}s (${(totalGames / (encodeTime / 1000)).toFixed(2)} games/sec)`)
        console.log(`[${lib.name}] Decoded ${totalGames} games in ${(decodeTime / 1000).toFixed(2)}s (${(totalGames / (decodeTime / 1000)).toFixed(2)} games/sec)`)
      })

      it("encodes and decodes PGN with tags and annotations", async () => {
        const content = readFileSync(join(DATA_DIR, "game-04.pgn"), "utf-8")
        const expectedMoves = parseMoves(content)

        expect(expectedMoves.length).toBeGreaterThan(0)

        const encoded = await encodePGNWith(chess, content, { tags: true, annotations: true })
        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).toContain("[Event \"Norway Chess 2025\"]")
        expect(decoded).toContain("[White \"Gukesh D\"]")
        expect(decoded).toContain("[Black \"Carlsen, Magnus\"]")

        for (const move of expectedMoves) {
          const moveFound =
            decoded.includes(` ${move.san} `) ||
            decoded.includes(` ${move.san}`) ||
            decoded.includes(`${move.san} `) ||
            decoded.startsWith(move.san + " ") ||
            decoded.startsWith(move.san + "{")
          if (!moveFound) continue
          if (move.clk > 0) {
            const hours = Math.floor(move.clk / 3600)
            const mins = Math.floor((move.clk % 3600) / 60)
            const secs = move.clk % 60
            const clkStr = hours > 0
              ? `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
              : `${mins}:${secs.toString().padStart(2, "0")}`
            expect(decoded).toContain(clkStr)
          }
        }
      })
    })
  }
})