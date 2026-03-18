# pgnpack

Ultra-compact PGN compression into Base64URL strings using bit-level encoding and optimized move ordering.

## Features

- PGN compression using legal move indexing
- Tag filtering support (e.g., `[Event]`, `[White]`, `[Black]`)
- Annotations and NAG support
- URL-safe output
- TypeScript support
- **Dual chess library support**: Works with either chess.js or chessops

## Install

```bash
npm install pgnpack
```

### Peer Dependencies

pgnpack requires one of the following chess libraries (optional peer dependencies):

```bash
# Option 1: Install chessops (preferred)
npm install chessops

# Option 2: Install chess.js
npm install chess.js

# Or both - pgnpack will auto-detect and prefer chessops
npm install chessops chess.js
```

## Generate Docs

```bash
npm run docs
```

Open `docs/index.html` to view.

## Example

```js
import { encodePGN, decodePGN } from "pgnpack"

const pgn = `1. e4 e5 2. Nf3 Nc6`

const code = await encodePGN(pgn)
console.log(code) // Compact base64url string

console.log(await decodePGN(code))

// With tags and annotations
const pgnWithMeta = `[Event "Test"]
[White "Player1"]
[Black "Player2"]

1. e4 e5 {Great opening} 2. Nf3`

const fullCode = await encodePGN(pgnWithMeta, {
  tags: ["Event", "White", "Black"],
  includeAnnotations: true
})

console.log(await decodePGN(fullCode))
// [Event "Test"]
// [White "Player1"]
// [Black "Player2"]
//
// 1. e4 e5 {Great opening} 2. Nf3

// Using explicit chess adapter (better for repeated calls)
import { createChessJsAdapter, encodePGNWith, decodePGNWith } from "pgnpack"

const chess = await createChessJsAdapter()
const code2 = await encodePGNWith(chess, pgn)
console.log(await decodePGNWith(chess, code2))
```

## API

### encodePGN(pgn, options)

Encodes a PGN string into a compact base64url string.

**Parameters:**
- `pgn: string` - PGN string
- `options?: EncodeOptions` - Encoding options

**EncodeOptions:**
```typescript
interface EncodeOptions {
  tags?: string | string[]   // Tags to include: "*" for all, or array like ["Event", "White"]
  includeAnnotations?: boolean   // Include move annotations and NAGs (default: false)
}
```

### decodePGN(code)

Decodes a compact base64url string back to PGN.

**Parameters:**
- `code: string` - Encoded base64url string

**Returns:** PGN string (with tags and annotations if they were encoded)

## Future Work

- **RAV (Recursive Annotation Variation) support**: Add support for encoding/decoding PGN files containing RAV (variations indicated by parentheses). Currently, RAV variations are stripped during encoding.

- **Efficient compression for meaningful annotations**: Add more efficient compression for meaningful annotations (i.e. evals, clocks). Currently, annotations are compressed using smol-string, but specialized encoding for structured data like evaluation scores and clock times could improve compression ratios.

## Third-Party Software

pgnpack uses the following third-party libraries:

### [chessops](https://github.com/niklasf/chessops)
Chess and chess variant rules and operations in TypeScript.

### [chess.js](https://github.com/jhlywa/chess.js)
A JavaScript chess library. Used as a fallback when chessops is not available.

### [smol-string](https://github.com/Senryoku/smol-string)
Compression for browsers' localStorage. Alternative to lz-string written in Zig.

## License

MIT
