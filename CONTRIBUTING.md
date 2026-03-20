# Contributing to pgnpack

Thank you for your interest in contributing to pgnpack! This document provides everything you need to get started.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Versioning System](#versioning-system)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9

## Getting Started

### 1. Fork the Repository

Fork the repository on GitHub, then clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/pgnpack.git
cd pgnpack
git remote add upstream https://github.com/supertorpe/pgnpack.git
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

```bash
npm run build
```

Output goes to `./dist/` (ESM, CJS, and declarations).

### 4. Run Tests

```bash
npm test
```

All tests should pass before making changes.

## Project Structure

```
pgnpack/
├── src/                    # Source code
│   ├── index.ts           # Public API exports
│   ├── constants.ts        # Version constants
│   ├── encoder/           # PGN encoding
│   │   └── encodePGN.ts   # Main encoder
│   ├── decoder/           # PGN decoding
│   │   └── decodePGN.ts   # Main decoder
│   ├── compression/       # Low-level encoding
│   │   ├── bitWriter.ts   # Bit accumulation
│   │   ├── bitReader.ts   # Bit extraction
│   │   ├── vlq.ts         # Variable-length quantity
│   │   └── base64url.ts   # URL-safe base64
│   ├── chess/             # Chess library adapters
│   │   ├── adapter.ts     # Unified interface
│   │   └── moveOrdering.ts # Heuristic move ordering
│   └── codec/             # Specialized codecs
│       └── tagCodec.ts    # Tag pair encoding
├── test/                  # Test files
│   ├── *.test.ts          # Unit tests
│   ├── data/              # Sample PGN files
│   └── fixtures/          # Encoded version fixtures
│       └── v1/            # v1 encoded strings
├── scripts/               # Utility scripts
│   ├── generateFixtures.ts
│   └── detectMinVersion.ts
├── dist/                  # Build output (generated)
├── docs/                  # Generated documentation
└── example/               # Usage examples
```

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

Follow the [Code Style](#code-style) guidelines.

### 3. Run Tests Continuously

```bash
npm run dev
```

This watches for file changes and rebuilds.

### 4. Run the Full Test Suite

```bash
npm test
```

### 5. Run Linting

```bash
npm run lint
```

### 6. Type Check

```bash
npx tsc --noEmit
```

## Testing

### Running Tests

```bash
npm test                    # Run all tests
npm test -- pgn.test.ts     # Single file
npm test -- --grep "roundtrip"  # By pattern
```

### Writing Tests

- Test files go in `test/` as `*.test.ts`
- Use Vitest's `describe` and `it` blocks
- Test both chess.js and chessops when applicable

```typescript
import { describe, it, expect, beforeAll } from "vitest"
import { encodePGNWith, decodePGNWith, createChessopsAdapter } from "../src"

describe("My feature", () => {
  let chess: Awaited<ReturnType<typeof createChessopsAdapter>>

  beforeAll(async () => {
    chess = await createChessopsAdapter()
  })

  it("does something", async () => {
    const result = await encodePGNWith(chess, "1. e4 e5")
    expect(result).toBeTruthy()
  })
})
```

### Sample PGN Files

Sample games for testing are in `test/data/`:

| File | Description |
|------|-------------|
| `game-01.pgn` | Short game with tags |
| `game-02.pgn` | Short game with tags |
| `game-04.pgn` | Game with annotations and eval/clk |

## Versioning System

pgnpack uses a version header in the encoded format to ensure backward compatibility.

### Format Structure

```
┌─────────────────────────────────────────────────────┐
│ Version (VLQ) │ Flags (2 bits) │ Data...            │
│   1-2 bytes   │                │                    │
└─────────────────────────────────────────────────────┘
```

### Version Constants

Defined in `src/constants.ts`:

```typescript
export const CURRENT_VERSION = 1  // Latest encoding format
export const MIN_COMPATIBLE_VERSION = 1  // Oldest supported
```

### Adding a New Version

When making **breaking changes** to the encoding algorithm:

#### Step 1: Update CURRENT_VERSION

Edit `src/constants.ts`:

```typescript
export const CURRENT_VERSION = 2  // Increment this
```

#### Step 2: Implement Changes

Modify encoder/decoder as needed.

#### Step 3: Generate Fixtures

```bash
npm run generate:fixtures
```

This creates `test/fixtures/v{CURRENT_VERSION}/` with encoded strings using the new format.

**Note:** This script will fail if the directory already exists (prevents accidental overwrites).

#### Step 4: Detect MIN_COMPATIBLE_VERSION

```bash
npm run detect:min-version
```

This script:
1. Tests all v2 fixtures against the new decoder
2. Tests v1 fixtures against the new decoder
3. Sets `MIN_COMPATIBLE_VERSION` based on results:
   - If v1 still decodes → `MIN_COMPATIBLE_VERSION = 1` (backward compatible)
   - If v1 fails → `MIN_COMPATIBLE_VERSION = 2` (breaking change)

**Note:** This script will fail if fixtures are missing for any version.

#### Step 5: Run Full Test Suite

```bash
npm test
```

#### Step 6: Commit

Commit includes:
- Code changes
- New fixture files in `test/fixtures/v{NEW_VERSION}/`
- Updated `MIN_COMPATIBLE_VERSION`

### Workflow Summary

```bash
# Make encoding changes...
git checkout -b feature/my-encoding-change

# Update version
# Edit src/constants.ts: CURRENT_VERSION = 2

# Generate new fixtures
npm run generate:fixtures

# Detect minimum compatible version
npm run detect:min-version

# Run tests
npm test && npm run lint && npx tsc --noEmit

# Commit
git add -A
git commit -m "feat: add v2 encoding with new move ordering"
```

### Fixture System

Fixtures are pre-encoded games stored in git for regression testing.

```
test/fixtures/
└── v1/
    ├── moves-only.game-01.encoded       # No tags, no annotations
    ├── with-tags.game-01.encoded        # Tags only
    ├── with-tags.game-02.encoded        # Tags only
    ├── with-annotations.game-04.encoded # Annotations only
    └── full.game-04.encoded             # Tags + annotations
```

Each fixture is a single-line text file with the base64url-encoded string.

## Code Style

### Naming Conventions

| Element         | Convention   | Example         |
|-----------------|--------------|-----------------|
| Files           | kebab-case   | `bitWriter.ts`  |
| Functions       | camelCase    | `encodePGN()`   |
| Classes         | PascalCase   | `BitWriter`     |
| Interfaces      | PascalCase   | `EncodeOptions` |
| Private members | `_camelCase` | `_bits`         |

### Imports

```typescript
// External imports first
import LZString from "lz-string"

// Blank line, then local imports
import { BitWriter } from "../compression/bitWriter"
import { CURRENT_VERSION } from "../constants"
```

### TypeScript

- Use explicit return types for exported functions
- Prefer interfaces over type aliases for public APIs

```typescript
export interface EncodeOptions {
  tags?: boolean | string[]
  annotations?: boolean
}

export function encodePGN(pgn: string, options?: EncodeOptions): Promise<string> {
  // ...
}
```

### Error Handling

```typescript
export async function decodePGN(code: string): Promise<string> {
  if (!code || typeof code !== "string") {
    throw new Error("Invalid input: code must be a non-empty string")
  }
  try {
    // decode logic
  } catch (e) {
    throw new Error(`Failed to decode PGN: ${e instanceof Error ? e.message : "Unknown error"}`)
  }
}
```

## Submitting Changes

### Before Submitting

1. All tests pass: `npm test`
2. Linting passes: `npm run lint`
3. Type checking passes: `npx tsc --noEmit`
4. Version fixtures are updated if encoding changed
5. Commit message follows conventional commits format

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

Examples:
```
feat(encoder): add version header to encoded format
fix(decoder): handle empty tags block correctly
refactor(compression): simplify bit packing logic
chore: update dependencies to latest versions
docs: update API documentation
test: add fixtures for v2 encoding
```

### Creating a Pull Request

Since you forked the repository, you need to push your changes to your fork and create a pull request against the original repository:

1. **Sync your fork** with the upstream repository:

   ```bash
   git checkout main
   git pull upstream main
   ```

2. **Create a feature branch** from main:

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** and commit them.

4. **Push to your fork**:

   ```bash
   git push origin feature/your-feature-name
   ```

5. **Open a pull request** on GitHub against the `main` branch of `supertorpe/pgnpack`.

6. **Describe your changes** clearly and link any related issues.

7. **Keep your fork in sync** by periodically pulling from upstream:

   ```bash
   git pull upstream main
   ```

## Quick Reference

```bash
# Setup
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Type check
npx tsc --noEmit

# Generate documentation
npm run docs

# Version management
npm run generate:fixtures      # Generate fixtures for current version
npm run detect:min-version     # Detect and update MIN_COMPATIBLE_VERSION
```

## Getting Help

- Open an issue on [GitHub](https://github.com/supertorpe/pgnpack/issues)
- Check the [README](README.md) for API documentation
