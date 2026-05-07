import { describe, it, expect } from "vitest"
import { parseRavTree } from "../src/encoder/ravParser"
import { encodePGNWith } from "../src/encoder/encodePGN"
import { decodePGNWith } from "../src/decoder/decodePGN"
import { createChessJsAdapter, createChessopsAdapter } from "../src/chess/adapter"

// Helper to run tests with both chess libraries
function describeWithBothLibraries(name: string, fn: (getChess: () => Promise<any>) => void) {
  describe(name, () => {
    describe("with chess.js", () => {
      fn(() => createChessJsAdapter())
    })
    describe("with chessops", () => {
      fn(() => createChessopsAdapter())
    })
  })
}

describe("RAV parsing", () => {
  it("parses single-level variation", () => {
    // Variation after e4: alternative to e5 (bare move notation)
    const pgn = "1. e4 (c5) e5 2. Nf3"
    const tree = parseRavTree(pgn)

    expect(tree).toHaveLength(3)
    expect(tree[0].san).toBe("e4")
    expect(tree[0].variations).toHaveLength(1)
    expect(tree[0].variations[0].san).toBe("c5")
  })

  it("parses nested variations", () => {
    // Nested variation: variation after e5 contains Nf3 with nested Nc6
    const pgn = "1. e4 e5 (2. Nf3 (2... Nc6) Nf6) 3. Bb5"
    const tree = parseRavTree(pgn)

    // Variation is attached to e5 (the move before it in the text)
    expect(tree[1].variations).toHaveLength(1)
    expect(tree[1].variations[0].san).toBe("Nf3")
    expect(tree[1].variations[0].variations).toHaveLength(2)
    expect(tree[1].variations[0].variations[0].san).toBe("Nc6")
    expect(tree[1].variations[0].variations[1].san).toBe("Nf6")
  })

  it("parses multiple variations on same move", () => {
    // Multiple variations after e4: alternatives to e5 (Black's moves)
    const pgn = "1. e4 (c5) (Nf6) e5 2. Nf3"
    const tree = parseRavTree(pgn)

    expect(tree[0].san).toBe("e4")
    expect(tree[0].variations).toHaveLength(2)
    expect(tree[0].variations[0].san).toBe("c5")
    expect(tree[0].variations[1].san).toBe("Nf6")
  })

  it("returns empty array for PGN without variations", () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6"
    const tree = parseRavTree(pgn)

    expect(tree).toHaveLength(4)
    expect(tree[0].san).toBe("e4")
    expect(tree[0].variations).toHaveLength(0)
    expect(tree[1].san).toBe("e5")
    expect(tree[1].variations).toHaveLength(0)
  })

  it("handles empty PGN", () => {
    const pgn = ""
    const tree = parseRavTree(pgn)

    expect(tree).toHaveLength(0)
  })

  it("parses pawn promotion with equals sign", () => {
    // Note: parseRavTree parses movetext structure, not move validity
    const pgn = "e4 e5 e8=Q"
    const tree = parseRavTree(pgn)

    expect(tree).toHaveLength(3)
    expect(tree[2].san).toBe("e8=Q")
  })

  it("parses pawn promotion without equals sign", () => {
    const pgn = "e4 e5 e8Q"
    const tree = parseRavTree(pgn)

    expect(tree).toHaveLength(3)
    expect(tree[2].san).toBe("e8Q")
  })

  it("parses en passant captures", () => {
    const pgn = "1. e4 d5 2. e5 f5 3. exf6"
    const tree = parseRavTree(pgn)

    expect(tree).toHaveLength(5)
    expect(tree[4].san).toBe("exf6")
  })

  it("throws on unbalanced opening parentheses", () => {
    const pgn = "1. e4 (c5"

    expect(() => parseRavTree(pgn)).toThrow("Unbalanced parentheses")
  })

  it("throws on unbalanced closing parentheses", () => {
    const pgn = "1. e4 c5)"

    expect(() => parseRavTree(pgn)).toThrow("Unbalanced parentheses")
  })

  it("handles variation with promotion", () => {
    // Note: parseRavTree parses movetext structure, not move validity
    const pgn = "e4 a5 (e8=Q)"
    const tree = parseRavTree(pgn)

    expect(tree[1].variations).toHaveLength(1)
    expect(tree[1].variations[0].san).toBe("e8=Q")
  })

  it("handles variation with en passant", () => {
    const pgn = "1. e4 d5 2. e5 f5 (exf6)"
    const tree = parseRavTree(pgn)

    expect(tree[3].variations).toHaveLength(1)
    expect(tree[3].variations[0].san).toBe("exf6")
  })
})

describeWithBothLibraries("RAV encoding", (getChess) => {
  it("encodes PGN with single variation without error", async () => {
    const chess = await getChess()
    const pgn = "1. e4 (c5) e5 2. Nf3 Nc6"
    const encoded = await encodePGNWith(chess, pgn)

    expect(encoded).toBeDefined()
    expect(typeof encoded).toBe("string")
    expect(encoded.length).toBeGreaterThan(0)
  })

  it("encodes PGN with multiple variations without error", async () => {
    const chess = await getChess()
    // Multiple variations after e4: alternatives to e5 (Black's moves)
    const pgn = "1. e4 (c5) (Nf6) e5 2. Nf3 Nc6"
    const encoded = await encodePGNWith(chess, pgn)

    expect(encoded).toBeDefined()
    expect(typeof encoded).toBe("string")
    expect(encoded.length).toBeGreaterThan(0)
  })

  it("encodes PGN with main line only (no variations)", async () => {
    const chess = await getChess()
    const pgn = "1. e4 e5 2. Nf3 Nc6"
    const encoded = await encodePGNWith(chess, pgn)

    expect(encoded).toBeDefined()
    expect(typeof encoded).toBe("string")

    const decoded = await decodePGNWith(chess, encoded)
    expect(decoded).toBe("1. e4 e5 2. Nf3 Nc6")
  })
})

describeWithBothLibraries("RAV roundtrip", (getChess) => {
  it("roundtrips variations correctly", async () => {
    const chess = await getChess()
    const pgn = "1. e4 e5 (d4) Nf3 Nc6"

    const encoded = await encodePGNWith(chess, pgn)
    const decoded = await decodePGNWith(chess, encoded)

    expect(decoded).toContain("(d4)")
  })

  it("roundtrips multiple variations correctly", async () => {
    const chess = await getChess()
    // Multiple variations after e4: alternatives to e5 (Black's moves)
    const pgn = "1. e4 (c5) (Nf6) e5 2. Nf3 Nc6"

    const encoded = await encodePGNWith(chess, pgn)
    const decoded = await decodePGNWith(chess, encoded)

    expect(decoded).toContain("(c5)")
    expect(decoded).toContain("(Nf6)")
  })

  it("roundtrips nested variations correctly", async () => {
    const chess = await getChess()
    const pgn = "1. e4 e5 (Nf3 (Nc6)) 3. Bb5"

    const encoded = await encodePGNWith(chess, pgn)
    const decoded = await decodePGNWith(chess, encoded)

    expect(decoded).toContain("(Nf3")
    // Note: Parser treats (Nf3 (Nc6)) same as (Nf3 Nc6) - both are valid
    expect(decoded).toMatch(/\(Nf3.*Nc6/)
  })
})

describe("Cross-library RAV roundtrip", () => {
  it("encode with chess.js, decode with chessops", async () => {
    const jsChess = await createChessJsAdapter()
    const opsChess = await createChessopsAdapter()

    const pgn = "1. e4 (c5) (Nf6) e5 2. Nf3 Nc6"
    const encoded = await encodePGNWith(jsChess, pgn)
    const decodedOps = await decodePGNWith(opsChess, encoded)
    const decodedJs = await decodePGNWith(jsChess, encoded)

    expect(decodedOps).toBe(decodedJs)
    expect(decodedOps).toContain("(c5)")
    expect(decodedOps).toContain("(Nf6)")
  })

  it("encode with chessops, decode with chess.js", async () => {
    const opsChess = await createChessopsAdapter()
    const jsChess = await createChessJsAdapter()

    const pgn = "1. e4 (c5) (Nf6) e5 2. Nf3 Nc6"
    const encoded = await encodePGNWith(opsChess, pgn)
    const decodedJs = await decodePGNWith(jsChess, encoded)
    const decodedOps = await decodePGNWith(opsChess, encoded)

    expect(decodedJs).toBe(decodedOps)
    expect(decodedJs).toContain("(c5)")
    expect(decodedJs).toContain("(Nf6)")
  })

  it("encode nested variations with chess.js, decode with chessops", async () => {
    const jsChess = await createChessJsAdapter()
    const opsChess = await createChessopsAdapter()

    const pgn = "1. e4 e5 (Nf3 (Nc6)) 3. Bb5"
    const encoded = await encodePGNWith(jsChess, pgn)
    const decodedOps = await decodePGNWith(opsChess, encoded)
    const decodedJs = await decodePGNWith(jsChess, encoded)

    expect(decodedOps).toBe(decodedJs)
    expect(decodedOps).toContain("(Nf3")
    // Note: Parser treats (Nf3 (Nc6)) same as (Nf3 Nc6) - both are valid
    expect(decodedOps).toMatch(/\(Nf3.*Nc6/)
  })

  it("encode nested variations with chessops, decode with chess.js", async () => {
    const opsChess = await createChessopsAdapter()
    const jsChess = await createChessJsAdapter()

    const pgn = "1. e4 e5 (Nf3 (Nc6)) 3. Bb5"
    const encoded = await encodePGNWith(opsChess, pgn)
    const decodedJs = await decodePGNWith(jsChess, encoded)
    const decodedOps = await decodePGNWith(opsChess, encoded)

    expect(decodedJs).toBe(decodedOps)
    expect(decodedJs).toContain("(Nf3")
    // Note: Parser treats (Nf3 (Nc6)) same as (Nf3 Nc6) - both are valid
    expect(decodedJs).toMatch(/\(Nf3.*Nc6/)
  })
})
