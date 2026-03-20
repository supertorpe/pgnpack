import { describe, it, expect, beforeAll } from "vitest"
import { encodePGN, decodePGN, createChessJsAdapter, createChessopsAdapter, encodePGNWith, decodePGNWith, CURRENT_VERSION, MIN_COMPATIBLE_VERSION } from "../src"

describe("PGN encode/decode", () => {
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

      it("roundtrip moves only", async () => {
        const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"

        const encoded = await encodePGNWith(chess, pgn)

        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).toBe(pgn)
      })

      it("encodes only specified tags", async () => {
        const pgn = `[Event "Test Tournament"]
[Site "London"]
[Date "2024.01.01"]
[White "Player A"]
[Black "Player B"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6`

        const encoded = await encodePGNWith(chess, pgn, { tags: ["Black", "White"] })
        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).toContain('[Black "Player B"]')
        expect(decoded).toContain('[White "Player A"]')
        expect(decoded).not.toContain("[Event")
        expect(decoded).not.toContain("[Site")
        expect(decoded).not.toContain("[Date")
        expect(decoded).not.toContain("[Result")
      })

      it("encodes no tags when empty array", async () => {
        const pgn = `[Event "Test Tournament"]
[Site "London"]
[White "Player A"]
[Black "Player B"]

1. e4 e5 2. Nf3 Nc6`

        const encoded = await encodePGNWith(chess, pgn, { tags: [] })
        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).not.toContain("[Event")
        expect(decoded).not.toContain("[Site")
        expect(decoded).not.toContain("[White")
        expect(decoded).not.toContain("[Black")
        expect(decoded).toBe("1. e4 e5 2. Nf3 Nc6")
      })

      it("encodes no tags when false", async () => {
        const pgn = `[Event "Test Tournament"]
[Site "London"]
[White "Player A"]
[Black "Player B"]

1. e4 e5 2. Nf3 Nc6`

        const encoded = await encodePGNWith(chess, pgn, { tags: false })
        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).not.toContain("[Event")
        expect(decoded).not.toContain("[Site")
        expect(decoded).not.toContain("[White")
        expect(decoded).not.toContain("[Black")
        expect(decoded).toBe("1. e4 e5 2. Nf3 Nc6")
      })

      it("encodes all tags with true", async () => {
        const pgn = `[Event "Test Tournament"]
[Site "London"]
[Date "2024.01.01"]
[White "Player A"]
[Black "Player B"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6`

        const encoded = await encodePGNWith(chess, pgn, { tags: true })
        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).toContain('[Event "Test Tournament"]')
        expect(decoded).toContain("[Site")
        expect(decoded).toContain("[Date")
        expect(decoded).toContain("[White")
        expect(decoded).toContain("[Black")
        expect(decoded).toContain("[Result")
        expect(decoded).toBe(`[Event "Test Tournament"]
[Site "London"]
[Date "2024.01.01"]
[White "Player A"]
[Black "Player B"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6`)
      })

      it("encodes NAGs and annotations with annotations", async () => {
        const pgn = "1. e4 $1 $14 {good move} e5 $4 2. d4 $13"

        const encoded = await encodePGNWith(chess, pgn, { annotations: true })
        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).toContain("$1")
        expect(decoded).toContain("$14")
        expect(decoded).toContain("$4")
        expect(decoded).toContain("$13")
        expect(decoded).toContain("{good move}")
      })

      it("does not encode NAGs or annotations without annotations", async () => {
        const pgn = "1. e4 $1 $14 {good move} e5 $4 2. d4 $13"

        const encoded = await encodePGNWith(chess, pgn)
        const decoded = await decodePGNWith(chess, encoded)

        expect(decoded).not.toContain("$1")
        expect(decoded).not.toContain("{good move}")
        expect(decoded).toBe("1. e4 e5 2. d4")
      })

      it("throws error for incompatible future version", async () => {
        const encoded = await encodePGNWith(chess, "1. e4 e5")
        const futureVersion = CURRENT_VERSION + 1
        const bytes = Buffer.from(encoded, "base64url")
        const modified = Buffer.concat([Buffer.from([futureVersion]), bytes.slice(1)])
        const badEncoded = modified.toString("base64url")

        await expect(decodePGNWith(chess, badEncoded)).rejects.toThrow(
          /Incompatible format version/
        )
      })
    })
  }
})

describe("Version compatibility", () => {
  it("throws error for version below MIN_COMPATIBLE_VERSION", async () => {
    const chess = await createChessopsAdapter()
    const encoded = await encodePGNWith(chess, "1. e4 e5")

    const incompatibleVersion = MIN_COMPATIBLE_VERSION - 1
    if (incompatibleVersion > 0) {
      const bytes = Buffer.from(encoded, "base64url")
      const modified = Buffer.concat([Buffer.from([incompatibleVersion]), bytes.slice(1)])
      const badEncoded = modified.toString("base64url")

      await expect(decodePGNWith(chess, badEncoded)).rejects.toThrow(
        /Incompatible format version/
      )
    }
  })
})
