import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { encodePGNWith, decodePGNWith, createChessJsAdapter, createChessopsAdapter } from "../src"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = join(__dirname, "data")

describe("Cross-library encode/decode", () => {
  const game04Pgn = readFileSync(join(DATA_DIR, "game-04.pgn"), "utf-8")

  it("encode with chess.js, decode with chess.js", async () => {
    const jsChess = await createChessJsAdapter()
    const jsChess2 = await createChessJsAdapter()

    const encoded = await encodePGNWith(jsChess, game04Pgn, { tags: true })
    const decoded = await decodePGNWith(jsChess2, encoded)

    expect(decoded).toContain('[Event "Norway Chess 2025"]')
    expect(decoded).toContain('[White "Gukesh D"]')
    expect(decoded).toContain('[Black "Carlsen, Magnus"]')
  })

  it("encode with chessops, decode with chessops", async () => {
    const opsChess = await createChessopsAdapter()
    const opsChess2 = await createChessopsAdapter()

    const encoded = await encodePGNWith(opsChess, game04Pgn, { tags: true })
    const decoded = await decodePGNWith(opsChess2, encoded)

    expect(decoded).toContain('[Event "Norway Chess 2025"]')
    expect(decoded).toContain('[White "Gukesh D"]')
    expect(decoded).toContain('[Black "Carlsen, Magnus"]')
  })

  it("simple PGN - encode with chess.js, decode with chess.js", async () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"
    const jsChess = await createChessJsAdapter()
    const jsChess2 = await createChessJsAdapter()

    const encoded = await encodePGNWith(jsChess, pgn)
    const decoded = await decodePGNWith(jsChess2, encoded)

    expect(decoded).toBe(pgn)
  })

  it("simple PGN - encode with chessops, decode with chessops", async () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"
    const opsChess = await createChessopsAdapter()
    const opsChess2 = await createChessopsAdapter()

    const encoded = await encodePGNWith(opsChess, pgn)
    const decoded = await decodePGNWith(opsChess2, encoded)

    expect(decoded).toBe(pgn)
  })

  it("simple PGN with tags - encode with chess.js, decode with chess.js", async () => {
    const pgn = `[Event "Test"]
[White "Player A"]
[Black "Player B"]

1. e4 e5`
    const jsChess = await createChessJsAdapter()
    const jsChess2 = await createChessJsAdapter()

    const encoded = await encodePGNWith(jsChess, pgn, { tags: true })
    const decoded = await decodePGNWith(jsChess2, encoded)

    expect(decoded).toContain('[Event "Test"]')
    expect(decoded).toContain('[White "Player A"]')
    expect(decoded).toContain('[Black "Player B"]')
  })

  it("simple PGN with tags - encode with chessops, decode with chessops", async () => {
    const pgn = `[Event "Test"]
[White "Player A"]
[Black "Player B"]

1. e4 e5`
    const opsChess = await createChessopsAdapter()
    const opsChess2 = await createChessopsAdapter()

    const encoded = await encodePGNWith(opsChess, pgn, { tags: true })
    const decoded = await decodePGNWith(opsChess2, encoded)

    expect(decoded).toContain('[Event "Test"]')
    expect(decoded).toContain('[White "Player A"]')
    expect(decoded).toContain('[Black "Player B"]')
  })
})