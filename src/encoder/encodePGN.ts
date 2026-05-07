/**
 * PGN Encoder - Compresses PGN chess games into compact base64url strings
 *
 * The encoding process:
 * 1. Parse PGN into header (tags), prelude comments, and move text
 * 2. Encode using custom bit-level encoding with move ordering
 *
 * Custom encoding:
 *   a. Generate all legal moves from current position
 *   b. Order them by likelihood (promotions, captures, checks)
 *   c. Write the index of the actual move (using minimal bits)
 *   d. Encode tags, prelude, and annotations as separate compressed blocks
 *
 * Variation encoding (v2 format):
 *   - Each variation is length-prefixed for robust decoding
 *   - 1 bit position flag (0=after, 1=before parent move)
 *   - 10 bits length prefix (up to 1024 bytes)
 *   - Variation content as byte-aligned bit stream
 */

import { withChess, ChessAdapter } from "../chess/adapter"
import { BitWriter } from "../compression/bitWriter"
import { base64urlEncode } from "../compression/base64url"
import { orderMoves } from "../chess/moveOrdering"
import { writeVLQ } from "../compression/vlq"
import LZString from "lz-string"
import { encodeTagsBlock } from "../codec/tagCodec"
import { CURRENT_VERSION } from "../constants"
import { MoveNode } from "../types"
import { parseRavTree } from "./ravParser"

export interface EncodeOptions {
  tags?: boolean | string[]
  annotations?: boolean
}

function parseAndFilterTags(tagsBlock: string, tagFilter: boolean | string[] | undefined): Array<{ name: string; value: string }> {
  if (!tagFilter || (Array.isArray(tagFilter) && tagFilter.length === 0)) {
    return []
  }

  const tagRegex = /\[(\w+)\s+"([^"]*)"\]/g
  const tags: Array<{ name: string; value: string }> = []
  let match

  if (tagFilter === true) {
    while ((match = tagRegex.exec(tagsBlock)) !== null) {
      tags.push({ name: match[1], value: match[2] })
    }
  } else {
    const allowedTags = new Set(Array.isArray(tagFilter) ? tagFilter : [tagFilter])
    const tempRegex = /\[(\w+)\s+"([^"]*)"\]/g
    while ((match = tempRegex.exec(tagsBlock)) !== null) {
      if (allowedTags.has(match[1])) {
        tags.push({ name: match[1], value: match[2] })
      }
    }
  }

  return tags
}

function removeAnnotations(pgn: string): string {
  let result = ""
  let inBlockAnnotation = false
  for (let i = 0; i < pgn.length; i++) {
    if (pgn[i] === "{" && !inBlockAnnotation) {
      inBlockAnnotation = true
      result += " "
    } else if (pgn[i] === "}" && inBlockAnnotation) {
      inBlockAnnotation = false
      result += " "
    } else if (pgn[i] === ";" && !inBlockAnnotation) {
      result += " "
      while (i + 1 < pgn.length && pgn[i + 1] !== "\n") {
        i++
        result += " "
      }
    } else if (!inBlockAnnotation) {
      result += pgn[i]
    } else {
      result += " "
    }
  }
  return result
}

function removeRav(pgn: string): string {
  let result = ""
  let depth = 0
  for (let i = 0; i < pgn.length; i++) {
    if (pgn[i] === "(") {
      depth++
    } else if (pgn[i] === ")") {
      depth--
    } else if (depth === 0) {
      result += pgn[i]
    }
  }
  return result
}

function extractPreludeComments(text: string): string[] {
  const comments: string[] = []
  let inBlockComment = false
  let currentComment = ""
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (ch === "{") {
      if (inBlockComment) {
        currentComment += ch
      } else {
        inBlockComment = true
        currentComment = "{"
      }
    } else if (ch === "}") {
      if (inBlockComment) {
        currentComment += ch
        comments.push(currentComment)
        currentComment = ""
        inBlockComment = false
      } else {
        currentComment += ch
      }
    } else if (ch === ";") {
      if (!inBlockComment) {
        const lineEnd = text.indexOf("\n", i)
        const endIndex = lineEnd === -1 ? text.length : lineEnd
        const lineComment = text.slice(i, endIndex).trim()
        if (lineComment) {
          comments.push(lineComment)
        }
        i = endIndex
        continue
      } else {
        currentComment += ch
      }
    } else if (inBlockComment) {
      currentComment += ch
    }
    i++
  }

  return comments
}

function extractPostMoveAnnotations(text: string): string {
  let result = ""
  let inBlockComment = false
  let i = 0
  const endIndex = text.length

  while (i < endIndex) {
    const ch = text[i]

    if (ch === "{") {
      if (!inBlockComment) {
        inBlockComment = true
        let commentEnd = text.indexOf("}", i)
        if (commentEnd === -1) commentEnd = endIndex
        const comment = text.slice(i, commentEnd + 1)
        if (result) result += " "
        result += comment
        i = commentEnd + 1
        continue
      }
    } else if (ch === "}") {
      if (inBlockComment) {
        inBlockComment = false
      }
    } else if (ch === ";") {
      if (!inBlockComment) {
        const lineEnd = text.indexOf("\n", i)
        const end = lineEnd === -1 ? endIndex : lineEnd
        const lineComment = text.slice(i, end).trim()
        if (lineComment) {
          if (result) result += " "
          result += lineComment
        }
        i = end
        continue
      }
    } else if (ch === "$" && !inBlockComment) {
      const match = text.slice(i).match(/^\$\d+/)
      if (match) {
        if (result) result += " "
        result += match[0]
        i += match[0].length
        continue
      }
    }

    if (!inBlockComment && !/\s/.test(ch) && ch !== "$" && ch !== "{" && ch !== "}" && ch !== ";") {
      break
    }
    i++
  }

  return result.trim()
}

async function findMovesAndPostText(prelude: string, movesSection: string, annotations: boolean = false): Promise<{ prelude: string[]; moves: Array<{ san: string; postText: string }> }> {
  return withChess(async (chess) => {
    const preludeComments = annotations ? extractPreludeComments(prelude) : []
    const result: Array<{ san: string; postText: string }> = []

    const pgnToParse = annotations ? movesSection : removeAnnotations(movesSection)

    let moves: ReturnType<typeof chess.history> = []
    try {
      const pgnWithoutAnnotations = removeRav(removeAnnotations(movesSection))
      chess.loadPgn(pgnWithoutAnnotations)
      moves = chess.history()
    } catch {
      moves = []
    }

    if (moves.length === 0) {
      const fallbackRegex = /(?:(\d+)\.\.*\s*)([KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*|[a-h][1-8](?:\=[KQRBNP])?[+#]*)\s*/g
      let match
      while ((match = fallbackRegex.exec(pgnToParse)) !== null) {
        const san = match[2]
        if (!san) continue
        try {
          const move = chess.move(san)
          if (move) {
            result.push({ san: move.san, postText: annotations ? match[0].trim() : "" })
          }
        } catch {
          continue
        }
      }
      return { prelude: preludeComments, moves: result }
    }

    chess.reset()

    const moveMatches: { index: number; end: number }[] = []
    const moveRegex = /(?:(\d+)\.\.*\s*)([KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*|[a-h][1-8](?:\=[KQRBNP])?[+#]*)\s*|([KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*|[a-h][1-8](?:\=[KQRBNP])?[+#]*)\s*/g
    let match
    while ((match = moveRegex.exec(pgnToParse)) !== null) {
      moveMatches.push({ index: match.index, end: match.index + match[0].length })
    }

    let moveIndex = 0

    for (let i = 0; i < moveMatches.length && moveIndex < moves.length; i++) {
      const currentMove = moveMatches[i]
      const move = moves[moveIndex] as { san: string } | undefined

      if (move) {
        let postText = ""
        if (annotations) {
          const nextMove = moveMatches[i + 1]
          const searchEnd = nextMove ? nextMove.index : pgnToParse.length
          const remainingText = pgnToParse.slice(currentMove.end, searchEnd)
          postText = extractPostMoveAnnotations(remainingText)
        }

        result.push({ san: move.san, postText })
        moveIndex++
      }
    }

    return { prelude: preludeComments, moves: result }
  })
}

function extractMoveTreeWithAnnotations(movesSection: string, annotations: boolean = false): { tree: MoveNode[]; flatAnnotations: string[] } {
  const tree = parseRavTree(movesSection)
  const flatAnnotations: string[] = []

  if (annotations) {
    const collectAnnotations = (nodes: MoveNode[]) => {
      for (const node of nodes) {
        flatAnnotations.push(node.postText || "")
        if (node.variations.length > 0) {
          collectAnnotations(node.variations)
        }
      }
    }
    collectAnnotations(tree)
  }

  return { tree, flatAnnotations }
}

function extractVariationLine(root: MoveNode): MoveNode[] {
  const line: MoveNode[] = []
  let current: MoveNode | undefined = root
  
  while (current) {
    line.push(current)
    current = current.variations[0]
  }
  
  return line
}

/**
 * Determines if a variation should be encoded from the BEFORE position
 * by testing if the first move is legal from the AFTER position
 */
function isVariationFromBefore(
  chess: ChessAdapter,
  _fenBeforeMove: string,
  fenAfterMove: string,
  variationLine: MoveNode[]
): boolean {
  if (variationLine.length === 0) return false
  
  const firstMoveSan = variationLine[0].san
  
  // Try from after position first
  chess.load(fenAfterMove)
  try {
    const result = chess.move(firstMoveSan)
    if (result) {
      return false  // Legal from after, use after position
    }
  } catch {
    // Move threw exception, try before position
  }
  
  // Try from before position
  chess.load(_fenBeforeMove)
  try {
    const result = chess.move(firstMoveSan)
    if (result) {
      return true  // Legal from before, use before position
    }
  } catch {
    // Neither position works - this is an error
    throw new Error(`Variation move ${firstMoveSan} is not legal from either position`)
  }
  
  return false
}

/**
 * Encodes a move tree (with variations) into the bitstream
 *
 * V2 format uses length-prefixed variations:
 * - 4 bits variation count
 * - 1 bit position flag (0=after, 1=before)
 * - 10 bits length (up to 1024 bytes)
 * - Variation content as bytes
 */
async function encodeMoveTree(
  chess: ChessAdapter,
  writer: BitWriter,
  tree: MoveNode[],
  annotationIndex: { value: number },
  allAnnotations: string[],
  _isRoot: boolean = true
) {
  const markerCount = 2
  const LENGTH_BITS = 10

  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    const ordered = orderMoves(chess)

    const _fenBeforeMove = chess.fen()

    const moveObj = chess.move(node.san)
    if (!moveObj) {
      throw new Error(`Failed to play move: ${node.san}`)
    }

    const fenAfterMove = chess.fen()

    const index = ordered.findIndex((m) => m.san === moveObj.san)
    if (index === -1) {
      throw new Error(`Move ${node.san} not found in ordered moves`)
    }

    const bits = Math.ceil(Math.log2(ordered.length + markerCount))
    writer.write(index, bits)

    allAnnotations[annotationIndex.value] = node.postText || ""
    annotationIndex.value++

    if (node.variations.length > 0) {
      const nextNode = i + 1 < tree.length ? tree[i + 1] : null
      const hasContinuation = node.variations.length > 0 && node.variations[0] === nextNode
      const startVarIndex = hasContinuation ? 1 : 0
      const numVariations = node.variations.length - startVarIndex

      // Write number of variations (4 bits = up to 15 variations per move)
      writer.write(numVariations, 4)

      for (let v = startVarIndex; v < node.variations.length; v++) {
        const variation = node.variations[v]
        const variationLine = extractVariationLine(variation)

        // Determine position
        const fromBefore = isVariationFromBefore(chess, _fenBeforeMove, fenAfterMove, variationLine)

        // Create temporary writer for variation content
        const tempWriter = new BitWriter()

        // Encode variation to temp writer as a FLAT tree (no chaining)
        chess.load(fromBefore ? _fenBeforeMove : fenAfterMove)
        await encodeMoveTreeAsFlat(chess, tempWriter, variationLine, annotationIndex, allAnnotations)
        chess.load(fenAfterMove)

        // Get variation bytes
        const variationBytes = tempWriter.toBytes()

        // Write position flag to main writer
        writer.write(fromBefore ? 1 : 0, 1)

        // Write length to main writer (10 bits)
        if (variationBytes.length >= (1 << LENGTH_BITS)) {
          throw new Error(`Variation too large: ${variationBytes.length} bytes (max: ${1 << LENGTH_BITS})`)
        }
        writer.write(variationBytes.length, LENGTH_BITS)

        // Write variation bytes to main writer
        for (const byte of variationBytes) {
          writer.write(byte, 8)
        }
      }

      chess.load(fenAfterMove)
    } else {
      // No variations - write 0 count
      writer.write(0, 4)
    }
  }

  // Write end-of-tree marker
  const ordered = orderMoves(chess)
  const bits = Math.ceil(Math.log2(ordered.length + markerCount))
  writer.write(ordered.length, bits)
}

/**
 * Encodes a move tree as a FLAT sequence (no chaining via variations[0])
 * This is used for encoding variations so they decode as proper sequences
 */
async function encodeMoveTreeAsFlat(
  chess: ChessAdapter,
  writer: BitWriter,
  tree: MoveNode[],
  annotationIndex: { value: number },
  allAnnotations: string[]
) {
  const markerCount = 2

  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    const ordered = orderMoves(chess)

    const moveObj = chess.move(node.san)
    if (!moveObj) {
      throw new Error(`Failed to play move: ${node.san}`)
    }

    const fenAfterMove = chess.fen()

    const index = ordered.findIndex((m) => m.san === moveObj.san)
    if (index === -1) {
      throw new Error(`Move ${node.san} not found in ordered moves`)
    }

    const bits = Math.ceil(Math.log2(ordered.length + markerCount))
    writer.write(index, bits)

    allAnnotations[annotationIndex.value] = node.postText || ""
    annotationIndex.value++

    // For flat encoding, we DON'T encode sub-variations here
    // They would need to be handled separately if needed
    writer.write(0, 4) // No sub-variations in flat mode

    chess.load(fenAfterMove)
  }

  // Write end-of-tree marker
  const ordered = orderMoves(chess)
  const bits = Math.ceil(Math.log2(ordered.length + markerCount))
  writer.write(ordered.length, bits)
}

async function splitPgnIntoParts(pgn: string, options: EncodeOptions = {}): Promise<{ tags: Array<{ name: string; value: string }>; prelude: string[]; moves: Array<{ san: string; postText: string }> }> {
  const lines = pgn.split("\n")

  let headerEndIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === "") continue
    if (!trimmed.startsWith("[")) {
      headerEndIndex = i
      break
    }
  }

  const rawTagsBlock = lines.slice(0, headerEndIndex).join("\n")
  const tags = parseAndFilterTags(rawTagsBlock, options.tags)

  const preludeSection = lines.slice(headerEndIndex).join(" ")

  let prelude = ""
  let movesSection = preludeSection

  const firstMoveMatch = preludeSection.match(/(\d+\.+\s*(?:[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*)|(?:^|\s)(?:[KQRBNP][a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*)\s)/)
  if (firstMoveMatch) {
    const firstMoveIndex = firstMoveMatch.index !== undefined ? firstMoveMatch.index : preludeSection.indexOf(firstMoveMatch[0])
    if (firstMoveIndex !== -1) {
      prelude = preludeSection.slice(0, firstMoveIndex)
      movesSection = preludeSection.slice(firstMoveIndex)
    }
  }

  const moveData = await findMovesAndPostText(prelude, movesSection, options.annotations ?? false)

  return { tags, prelude: moveData.prelude, moves: moveData.moves }
}

function getMetadataFlags(options: EncodeOptions): { hasTags: boolean; hasAnnotations: boolean } {
  const hasTags = Boolean(options.tags && (options.tags === true || (Array.isArray(options.tags) && options.tags.length > 0)))
  const hasAnnotations = options.annotations ?? false
  return { hasTags, hasAnnotations }
}

async function _encodePGN(chess: ChessAdapter, pgn: string, options: EncodeOptions): Promise<string> {
  const { hasTags, hasAnnotations } = getMetadataFlags(options)

  const parts = await splitPgnIntoParts(pgn, options)
  const tags = parts.tags
  const prelude = parts.prelude

  // Extract movetext section for tree parsing
  const lines = pgn.split("\n")
  let headerEndIndex = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === "") continue
    if (!trimmed.startsWith("[")) {
      headerEndIndex = i
      break
    }
  }
  const movesSection = lines.slice(headerEndIndex).join(" ").trim()
  const { tree, flatAnnotations } = extractMoveTreeWithAnnotations(movesSection, hasAnnotations)

  // Tree encoding is always used; the flag ensures the decoder enters tree path
  const hasVariations = true

  chess.reset()
  const customWriter = new BitWriter()

  writeVLQ(customWriter, CURRENT_VERSION)
  customWriter.write(hasTags ? 1 : 0, 1)
  customWriter.write(hasAnnotations ? 1 : 0, 1)
  customWriter.write(hasVariations ? 1 : 0, 1)

  if (hasTags) {
    const tagsString = tags.map(t => `[${t.name} "${t.value}"]`).join("\n")
    const { bytes, length } = encodeTagsBlock(tagsString)
    writeVLQ(customWriter, length)
    for (const byte of bytes) {
      customWriter.write(byte, 8)
    }
  }

  if (hasAnnotations) {
    const preludeStr = prelude.join("\n")
    const preludeCompressed = preludeStr ? LZString.compressToEncodedURIComponent(preludeStr) : ""
    const preludeBytes = new TextEncoder().encode(preludeCompressed)
    writeVLQ(customWriter, preludeBytes.length)
    for (const byte of preludeBytes) {
      customWriter.write(byte, 8)
    }

    // Write annotations in tree depth-first order
    const annotationsStr = flatAnnotations.length > 0 ? flatAnnotations.join("\x00") : ""
    const annotationsCompressed = annotationsStr ? LZString.compressToEncodedURIComponent(annotationsStr) : ""
    const annotationsBytes = new TextEncoder().encode(annotationsCompressed)
    writeVLQ(customWriter, annotationsBytes.length)
    for (const byte of annotationsBytes) {
      customWriter.write(byte, 8)
    }
  }

  // Always encode as tree
  const allAnnotations = hasAnnotations ? [...flatAnnotations] : []
  const annotationIndex = { value: 0 }

  const treeWriter = new BitWriter()
  await encodeMoveTree(chess, treeWriter, tree, annotationIndex, allAnnotations, true)
  const treeBytes = treeWriter.toBytes()
  writeVLQ(customWriter, treeBytes.length)
  for (const byte of treeBytes) {
    customWriter.write(byte, 8)
  }

  const customEncoded = base64urlEncode(customWriter.toBytes())
  return customEncoded
}

export async function encodePGN(pgn: string, options: EncodeOptions = {}): Promise<string> {
  return withChess(async (chess) => _encodePGN(chess, pgn, options))
}

export async function encodePGNWith(chess: ChessAdapter, pgn: string, options: EncodeOptions = {}): Promise<string> {
  return _encodePGN(chess, pgn, options)
}
