import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { decodePGNWith, createChessopsAdapter } from "../src/index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

interface VersionInfo {
  current: number
  min: number
}

async function getVersionInfo(): Promise<VersionInfo> {
  const constantsPath = join(__dirname, "../src/constants.ts")
  const content = readFileSync(constantsPath, "utf-8")

  const currentMatch = content.match(/export const CURRENT_VERSION = (\d+)/)
  const minMatch = content.match(/export const MIN_COMPATIBLE_VERSION = (\d+)/)

  if (!currentMatch || !minMatch) {
    throw new Error("Could not find version constants in constants.ts")
  }

  return {
    current: parseInt(currentMatch[1], 10),
    min: parseInt(minMatch[1], 10),
  }
}

function updateMinVersion(newMin: number): void {
  const constantsPath = join(__dirname, "../src/constants.ts")
  const content = readFileSync(constantsPath, "utf-8")

  const updated = content.replace(
    /export const MIN_COMPATIBLE_VERSION = \d+/,
    `export const MIN_COMPATIBLE_VERSION = ${newMin}`
  )

  writeFileSync(constantsPath, updated)
}

async function testFixture(chess: Awaited<ReturnType<typeof createChessopsAdapter>>, fixturePath: string): Promise<boolean> {
  try {
    const encoded = readFileSync(fixturePath, "utf-8").trim()
    await decodePGNWith(chess, encoded)
    return true
  } catch {
    return false
  }
}

async function detectMinVersion(): Promise<number> {
  const { current: currentVersion } = await getVersionInfo()
  const fixturesBaseDir = join(__dirname, "../test/fixtures")
  const chess = await createChessopsAdapter()

  console.log(`Current version: ${currentVersion}`)
  console.log(`Checking fixtures from newest to oldest...\n`)

  for (let v = currentVersion; v >= 1; v--) {
    const versionDir = join(fixturesBaseDir, `v${v}`)

    if (!existsSync(versionDir)) {
      console.error(`Error: Missing fixtures for v${v}`)
      console.error(`Run 'npm run generate:fixtures' to generate fixtures for v${v}`)
      process.exit(1)
    }

    const files = readdirSync(versionDir).filter((f) => f.endsWith(".encoded"))
    console.log(`Testing v${v} fixtures (${files.length} files)...`)

    let allPass = true
    for (const file of files) {
      const fixturePath = join(versionDir, file)
      const passed = await testFixture(chess, fixturePath)
      const status = passed ? "PASS" : "FAIL"
      console.log(`  ${file}: ${status}`)
      if (!passed) {
        allPass = false
      }
    }

    if (allPass) {
      console.log(`\nMIN_COMPATIBLE_VERSION = ${v}`)
      return v
    }

    console.log(`v${v} fixtures failed, trying older version...\n`)
  }

  console.error("Error: No compatible version found")
  process.exit(1)
}

async function main(): Promise<void> {
  const newMin = await detectMinVersion()

  const { min: oldMin } = await getVersionInfo()

  if (newMin !== oldMin) {
    updateMinVersion(newMin)
    console.log(`Updated MIN_COMPATIBLE_VERSION: ${oldMin} -> ${newMin}`)
  } else {
    console.log(`MIN_COMPATIBLE_VERSION unchanged: ${newMin}`)
  }
}

main().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
