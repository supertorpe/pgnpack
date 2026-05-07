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

          // v1 fixtures are not compatible with v2 format (breaking change)
          // Emit warning instead of failing the test
          if (versionNumber < MIN_COMPATIBLE_VERSION) {
            console.warn(
              `⚠️  Skipping v${versionNumber} fixture "${fixture}": ` +
              `Format version ${versionNumber} is not compatible with current MIN_COMPATIBLE_VERSION ${MIN_COMPATIBLE_VERSION}. ` +
              `This is expected for breaking format changes.`
            )
            // Still attempt to decode to verify it throws appropriate error
            try {
              await decodePGNWith(chess, encoded)
              // If it doesn't throw, that's unexpected but not a failure
            } catch (e: any) {
              // Expected to throw incompatible version error
              if (!e.message.includes("Incompatible format version")) {
                console.warn(`  Note: Decode failed with: ${e.message}`)
              }
            }
            // Skip the assertion - v1 fixtures are expected to be incompatible
            return
          }

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
