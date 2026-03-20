import { describe, it, expect, beforeAll } from "vitest"
import { readdirSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { decodePGNWith, createChessopsAdapter, MIN_COMPATIBLE_VERSION, CURRENT_VERSION } from "../src"

describe("Version compatibility", () => {
  let chess: Awaited<ReturnType<typeof createChessopsAdapter>>

  beforeAll(async () => {
    chess = await createChessopsAdapter()
  })

  const fixturesDir = join(__dirname, "fixtures")

  const versionDirs = existsSync(fixturesDir)
    ? readdirSync(fixturesDir)
        .filter((d) => /^v\d+$/.test(d))
        .sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)))
    : []

  for (const versionDir of versionDirs) {
    const versionNumber = parseInt(versionDir.slice(1), 10)

    describe(`v${versionNumber} fixtures`, () => {
      const fixtures = readdirSync(join(fixturesDir, versionDir)).filter(
        (f) => f.endsWith(".encoded")
      )

      for (const fixture of fixtures) {
        it(`can decode ${versionDir}/${fixture}`, async () => {
          const encoded = readFileSync(
            join(fixturesDir, versionDir, fixture),
            "utf-8"
          ).trim()

          const decoded = await decodePGNWith(chess, encoded)
          expect(decoded).toBeTruthy()
          expect(typeof decoded).toBe("string")
          expect(decoded.length).toBeGreaterThan(0)
        })
      }
    })
  }

  if (versionDirs.length === 0) {
    describe("No fixtures", () => {
      it("should have fixtures directory with versioned fixtures", () => {
        expect(existsSync(fixturesDir)).toBe(true)
      })
    })
  }
})

describe("MIN_COMPATIBLE_VERSION validation", () => {
  it("should be within supported range", () => {
    expect(MIN_COMPATIBLE_VERSION).toBeGreaterThanOrEqual(1)
    expect(MIN_COMPATIBLE_VERSION).toBeLessThanOrEqual(CURRENT_VERSION)
  })

  it("CURRENT_VERSION should be >= MIN_COMPATIBLE_VERSION", () => {
    expect(CURRENT_VERSION).toBeGreaterThanOrEqual(MIN_COMPATIBLE_VERSION)
  })
})
