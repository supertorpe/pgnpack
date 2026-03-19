/**
 * PGN Encoder - Compresses PGN chess games into compact base64url strings
 * 
 * The encoding process:
 * 1. Parse PGN into header (tags), prelude comments, and move text
 * 2. Try both custom encoding and lz-string compression
 * 3. Use the shorter result (with header to indicate method)
 * 
 * Custom encoding:
 *   a. Generate all legal moves from current position
 *   b. Order them by likelihood (promotions, captures, checks)
 *   c. Write the index of the actual move (using minimal bits)
 *   d. Encode tags, prelude, and annotations as separate compressed blocks
 * 
 * lz-string fallback:
 *   - If lz-string compression produces shorter result than custom encoding,
 *     use it instead with a flag to indicate this in the header.
 */

import { withChess, ChessAdapter } from "../chess/adapter"
import { BitWriter } from "../compression/bitWriter"
import { base64urlEncode } from "../compression/base64url"
import { orderMoves } from "../chess/moveOrdering"
import { writeVLQ } from "../compression/vlq"
import LZString from "lz-string"
import { encodeTagsBlock } from "../codec/tagCodec"

/**
 * Options for encoding PGN
 */
export interface EncodeOptions {
  tags?: boolean | string[]  // Which tag pairs to include: true for all, false for none (by default), or array of tag names
  annotations?: boolean // Whether to include NAGs, comments, and prelude
}

/**
 * Parses and filters PGN tag pairs based on options
 * 
 * @param tagsBlock - Raw tag section from PGN
 * @param tagFilter - true for all, false for none, or array of tag names
 * @returns Array of parsed tag objects
 */
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

/**
 * Removes comments and NAG (Numeric Annotation Glyphs) from PGN
 * 
 * Strips:
 * - Block comments: { comment }
 * - Line comments: ; comment
 * - NAGs: $1, $2, etc.
 * 
 * Preserves spaces to maintain move positions in the string.
 * @param pgn - Raw PGN string
 * @returns PGN with annotations removed
 */
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

/**
 * Removes Recursive Annotation Variations (RAV) from PGN
 * 
 * @param pgn - Raw PGN string
 * @returns PGN with variations removed
 */
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

/**
 * Extracts prelude comments from PGN (comments between tags and first move)
 * 
 * @param text - Text between tags and moves
 * @returns Array of prelude comment strings
 */
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

/**
 * Extracts annotations (NAGs, comments) following a move
 * 
 * @param text - Text after the move
 * @returns Combined annotation string
 */
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

/**
 * Extracts moves and optional post-move text (annotations) from PGN
 * 
 * @param prelude - Prelude section (before first move)
 * @param movesSection - Section containing moves
 * @param annotations - Whether to extract annotations
 * @returns Object with prelude comments and moves with annotations
 */
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

/**
 * Builds a filtered PGN string from parsed components
 */
function buildFilteredPgnString(
  tags: Array<{ name: string; value: string }>,
  prelude: string[],
  moveList: string[],
  postTexts: string[],
  annotations: boolean
): string {
  const tagsStr = tags.map(t => `[${t.name} "${t.value}"]`).join("\n")
  const preludeStr = prelude.join(" ")

  const moveTokens: string[] = []
  for (let i = 0; i < moveList.length; i++) {
    const postText = annotations ? (postTexts[i] || "") : ""
    if (i % 2 === 0) {
      moveTokens.push(`${Math.floor(i / 2) + 1}. ${moveList[i]}${postText ? " " + postText : ""}`)
    } else {
      moveTokens.push(`${moveList[i]}${postText ? " " + postText : ""}`)
    }
  }

  let result = tagsStr
  if (preludeStr) {
    result += (result ? "\n" : "") + preludeStr
  }
  if (moveTokens.length > 0) {
    result += (result ? "\n" : "") + moveTokens.join(" ")
  }
  return result
}

/**
 * Splits PGN into header tags, prelude comments, and move text
 */
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

/**
 * Extracts metadata flags from encoding options
 */
function getMetadataFlags(options: EncodeOptions): { hasTags: boolean; hasAnnotations: boolean; hasMetadata: boolean } {
  const hasTags = Boolean(options.tags && (options.tags === true || (Array.isArray(options.tags) && options.tags.length > 0)))
  const hasAnnotations = options.annotations ?? false
  const hasMetadata = hasTags || hasAnnotations
  return { hasTags, hasAnnotations, hasMetadata }
}

/**
 * Core encoding logic - used by both encodePGN and encodePGNWith
 */
async function _encodePGN(chess: ChessAdapter, pgn: string, options: EncodeOptions): Promise<string> {
  const { hasMetadata, hasAnnotations } = getMetadataFlags(options)

  const parts = await splitPgnIntoParts(pgn, options)
  const tags = parts.tags
  const prelude = parts.prelude
  const moveList = parts.moves.map((m) => m.san)
  const postTexts = parts.moves.map((m) => m.postText)

  chess.loadPgn(moveList.join(" "))
  chess.reset()

  const customWriter = new BitWriter()

  customWriter.write(hasMetadata ? 1 : 0, 2)

  if (hasMetadata) {
    const tagsString = tags.map(t => `[${t.name} "${t.value}"]`).join("\n")
    const { bytes, length } = encodeTagsBlock(tagsString)
    writeVLQ(customWriter, length)
    for (const byte of bytes) {
      customWriter.write(byte, 8)
    }

    if (hasAnnotations) {
      const preludeStr = prelude.join("\n")
      const preludeCompressed = preludeStr ? LZString.compressToEncodedURIComponent(preludeStr) : ""
      const preludeBytes = new TextEncoder().encode(preludeCompressed)
      writeVLQ(customWriter, preludeBytes.length)
      for (const byte of preludeBytes) {
        customWriter.write(byte, 8)
      }

      const annotationsStr = postTexts.join("\x00")
      const annotationsCompressed = annotationsStr ? LZString.compressToEncodedURIComponent(annotationsStr) : ""
      const annotationsBytes = new TextEncoder().encode(annotationsCompressed)
      writeVLQ(customWriter, annotationsBytes.length)
      for (const byte of annotationsBytes) {
        customWriter.write(byte, 8)
      }
    }
  }

  writeVLQ(customWriter, moveList.length)

  for (let i = 0; i < moveList.length; i++) {
    const san = moveList[i]
    const ordered = orderMoves(chess)

    const moveObj = chess.move(san)
    if (!moveObj) {
      throw new Error(`Failed to play move: ${san}`)
    }

    const index = ordered.findIndex((m) => m.san === moveObj.san)

    const bits = Math.ceil(Math.log2(ordered.length))

    customWriter.write(index, bits)
  }

  const customEncoded = base64urlEncode(customWriter.toBytes())

  if (!hasMetadata || customEncoded.length < 50) {
    return customEncoded
  }

  const filteredPgn = buildFilteredPgnString(tags, prelude, moveList, postTexts, options.annotations ?? false)
  const lzCompressed = LZString.compressToEncodedURIComponent(filteredPgn)
  const lzEncoded = "lz_" + lzCompressed

  return customEncoded.length <= lzEncoded.length ? customEncoded : lzEncoded
}

export async function encodePGN(pgn: string, options: EncodeOptions = {}): Promise<string> {
  return withChess(async (chess) => _encodePGN(chess, pgn, options))
}

export async function encodePGNWith(chess: ChessAdapter, pgn: string, options: EncodeOptions = {}): Promise<string> {
  return _encodePGN(chess, pgn, options)
}
