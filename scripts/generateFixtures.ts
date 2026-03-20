import { readFileSync, mkdirSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { encodePGNWith, createChessopsAdapter } from "../src/index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

async function getCurrentVersion(): Promise<number> {
  const constantsPath = join(__dirname, "../src/constants.ts")
  const content = readFileSync(constantsPath, "utf-8")
  const match = content.match(/export const CURRENT_VERSION = (\d+)/)
  if (!match) {
    throw new Error("Could not find CURRENT_VERSION in constants.ts")
  }
  return parseInt(match[1], 10)
}

interface FixtureDefinition {
  name: string
  source: string
  tags: boolean
  annotations: boolean
}

const fixtures: FixtureDefinition[] = [
  { name: "moves-only.game-01", source: "game-01.pgn", tags: false, annotations: false },
  { name: "with-tags.game-01", source: "game-01.pgn", tags: true, annotations: false },
  { name: "with-tags.game-02", source: "game-02.pgn", tags: true, annotations: false },
  { name: "with-annotations.game-04", source: "game-04.pgn", tags: false, annotations: true },
  { name: "full.game-04", source: "game-04.pgn", tags: true, annotations: true },
]

async function generateFixtures(): Promise<void> {
  const version = await getCurrentVersion()
  const fixturesDir = join(__dirname, `../test/fixtures/v${version}`)
  const dataDir = join(__dirname, "../test/data")

  if (existsSync(fixturesDir)) {
    console.error(`Error: Fixtures directory already exists: ${fixturesDir}`)
    console.error("Remove it first or bump CURRENT_VERSION in constants.ts")
    process.exit(1)
  }

  mkdirSync(fixturesDir, { recursive: true })

  const chess = await createChessopsAdapter()

  for (const fixture of fixtures) {
    const pgnPath = join(dataDir, fixture.source)
    const pgn = readFileSync(pgnPath, "utf-8")

    const encoded = await encodePGNWith(chess, pgn, {
      tags: fixture.tags,
      annotations: fixture.annotations,
    })

    const filename = `${fixture.name}.encoded`
    const filepath = join(fixturesDir, filename)
    writeFileSync(filepath, encoded)
    console.log(`Generated: ${filename}`)
  }

  console.log(`\nFixtures generated in: ${fixturesDir}`)
}

generateFixtures().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
