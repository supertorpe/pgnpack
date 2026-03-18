/**
 * PGN Encoder - Compresses PGN chess games into compact base64url strings
 * 
 * The encoding process:
 * 1. Parse PGN into header (tags) and move text
 * 2. Filter tags based on options (include all, specific, or none)
 * 3. Remove annotations and RAV (variations) unless requested
 * 4. For each move:
 *    a. Generate all legal moves from current position
 *    b. Order them by likelihood (promotions, captures, checks)
 *    c. Write the index of the actual move (using minimal bits)
 *    d. If annotations enabled, compress and write post-move text
 * 5. Convert bits to bytes, then to base64url
 * 
 * The compression comes from move ordering: by predicting likely moves,
 * we use fewer bits to identify which of the legal moves was played.
 */

import { withChess, ChessAdapter } from "../chess/adapter"
import { BitWriter } from "../compression/bitWriter"
import { base64urlEncode } from "../compression/base64url"
import { orderMoves } from "../chess/moveOrdering"
import { writeVLQ } from "../compression/vlq"
import { compress } from "smol-string"

/**
 * Options for encoding PGN
 */
export interface EncodeOptions {
  tags?: string | string[]  // Which tag pairs to include: "*" for all, or array of tag names
  includeAnnotations?: boolean // Whether to include NAGs and comments
}

/**
 * Filters PGN tag pairs based on options
 * 
 * Used to selectively include header tags in the encoded output.
 * Returns empty string if no tags should be included.
 * @param tagsBlock - Raw tag section from PGN
 * @param tagFilter - "*" for all, or array of tag names to include
 * @returns Filtered tag block string
 */
function filterTags(tagsBlock: string, tagFilter: string | string[] | undefined): string {
  if (!tagFilter || (Array.isArray(tagFilter) && tagFilter.length === 0)) {
    return ""
  }

  if (tagFilter === "*") {
    return tagsBlock
  }

  const allowedTags = new Set(Array.isArray(tagFilter) ? tagFilter : [tagFilter])

  const lines = tagsBlock.split("\n")
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith("[")) return false
    const match = trimmed.match(/^\[(\w+)\s+/)
    if (!match) return false
    return allowedTags.has(match[1])
  })

  return filteredLines.join("\n")
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
 * RAVs are alternative move sequences enclosed in parentheses.
 * This strips everything inside parentheses, keeping only the main line.
 * Uses a depth counter to handle nested parentheses correctly.
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
 * Extracts moves and optional post-move text (annotations) from PGN
 * 
 * First attempts to use the chess library's built-in PGN parser.
 * If that fails (e.g., due to invalid PGN), falls back to regex extraction.
 * 
 * Post-text includes NAGs (e.g., "$1", "$2") and block comments that follow a move.
 * @param pgn - PGN string to parse
 * @param includeAnnotations - Whether to extract annotations
 * @returns Array of {san, postText} objects for each move
 */
async function findMovesAndPostText(pgn: string, includeAnnotations: boolean = false): Promise<Array<{ san: string; postText: string }>> {
  return withChess(async (chess) => {
    const result: Array<{ san: string; postText: string }> = []

    const pgnToParse = includeAnnotations ? pgn : removeAnnotations(pgn)

    let moves: ReturnType<typeof chess.history> = []
    try {
      const pgnWithoutAnnotations = removeRav(removeAnnotations(pgn))
      chess.loadPgn(pgnWithoutAnnotations)
      moves = chess.history()
    } catch {
      moves = []
    }

    if (moves.length === 0) {
      // Fallback: extract moves using regex when PGN parsing fails
      const fallbackRegex = /(?:(\d+)\.\s*)?([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*)\s*/g
      let match
      while ((match = fallbackRegex.exec(pgnToParse)) !== null) {
        const san = match[2]
        if (!san) continue
        try {
          const move = chess.move(san)
          if (move) {
            result.push({ san: move.san, postText: includeAnnotations ? match[0].trim() : "" })
          }
        } catch {
          continue
        }
      }
      return result
    }

    chess.reset()

    // Find all move positions in the PGN text to extract post-move annotations
    const moveMatches: { index: number; end: number }[] = []
    const moveRegex = /(?:(\d+)\.\s*)?([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*)\s*/g
    let match
    while ((match = moveRegex.exec(pgnToParse)) !== null) {
      moveMatches.push({ index: match.index, end: match.index + match[0].length })
    }

    let moveIndex = 0

    // Match parsed moves with their positions in the original PGN
    for (let i = 0; i < moveMatches.length && moveIndex < moves.length; i++) {
      const currentMove = moveMatches[i]

      const move = moves[moveIndex] as { san: string } | undefined
      if (move) {
        let postText = ""
        if (includeAnnotations) {
          const nextMove = moveMatches[i + 1]
          const searchEnd = nextMove ? nextMove.index : pgnToParse.length

          const remainingText = pgnToParse.slice(currentMove.end, searchEnd)

          // Extract NAGs (Numeric Annotation Glyphs like $1, $2)
          const nagMatches = remainingText.match(/(\$\d+)/g)
          if (nagMatches) {
            postText = nagMatches.join(" ")
          }

          // Extract block comments following the move
          const annotationMatch = remainingText.match(/(\{[^}]*\})/)
          if (annotationMatch) {
            if (postText) postText += " "
            postText += annotationMatch[1]
          }
        }

        result.push({ san: move.san, postText })
        moveIndex++
      }
    }

    return result
  })
}

/**
 * Splits PGN into header tags and move text
 * 
 * Separates the PGN file into:
 * - Filtered tag block (based on options.tags)
 * - Move data (including optional annotations)
 * 
 * Finds the boundary between header and moves by looking for the first
 * non-tag line.
 * @param pgn - Full PGN string
 * @param options - Encoding options
 * @returns Separated tags and moves
 */
async function splitPgnIntoParts(pgn: string, options: EncodeOptions = {}): Promise<{ tagsBlock: string; moves: Array<{ san: string; postText: string }> }> {
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
  const tagsBlock = filterTags(rawTagsBlock, options.tags)

  const movesSection = headerEndIndex > 0 ? lines.slice(headerEndIndex).join(" ") : pgn
  const moveData = await findMovesAndPostText(movesSection, options.includeAnnotations ?? false)

  return { tagsBlock, moves: moveData }
}

/**
 * Extracts metadata flags from encoding options
 */
function getMetadataFlags(options: EncodeOptions): { hasTags: boolean; hasAnnotations: boolean; hasMetadata: boolean } {
  const hasTags = Boolean(options.tags && (options.tags === "*" || (Array.isArray(options.tags) && options.tags.length > 0)))
  const hasAnnotations = options.includeAnnotations ?? false
  const hasMetadata = hasTags || hasAnnotations
  return { hasTags, hasAnnotations, hasMetadata }
}

/**
 * Core encoding logic - used by both encodePGN and encodePGNWith
 */
async function _encodePGN(chess: ChessAdapter, pgn: string, options: EncodeOptions): Promise<string> {
  const { hasMetadata } = getMetadataFlags(options)

  const parts = await splitPgnIntoParts(pgn, options)
  const tagsBlock = parts.tagsBlock
  const moveList = parts.moves.map((m) => m.san)
  const postTexts = parts.moves.map((m) => m.postText)

  chess.loadPgn(moveList.join(" "))
  chess.reset()

  const writer = new BitWriter()

  writer.write(hasMetadata ? 0 : 1, 1)

  if (hasMetadata && tagsBlock) {
    const compressed = compress(tagsBlock)
    const charCodes = new Uint16Array(compressed.length)
    for (let i = 0; i < compressed.length; i++) {
      charCodes[i] = compressed.charCodeAt(i)
    }
    const bytes = new Uint8Array(charCodes.buffer)
    writeVLQ(writer, bytes.length)
    for (const byte of bytes) {
      writer.write(byte, 8)
    }
  } else {
    writeVLQ(writer, 0)
  }

  writeVLQ(writer, moveList.length)

  for (let i = 0; i < moveList.length; i++) {
    const san = moveList[i]
    const ordered = orderMoves(chess)

    // Use chess.move to play the move and get canonical SAN
    // This handles the SAN differences between input and library output
    const moveObj = chess.move(san)
    if (!moveObj) {
      throw new Error(`Failed to play move: ${san}`)
    }
    
    // Find the index of the move in the ordered list
    // This is O(n) but n is small (number of legal moves at position)
    const index = ordered.findIndex((m) => m.san === moveObj.san)
    
    const bits = Math.ceil(Math.log2(ordered.length))

    writer.write(index, bits)

    if (hasMetadata) {
      const postText = postTexts[i] || ""
      const compressed = postText ? compress(postText) : ""
      const charCodes = new Uint16Array(compressed.length)
      for (let j = 0; j < compressed.length; j++) {
        charCodes[j] = compressed.charCodeAt(j)
      }
      const bytes = new Uint8Array(charCodes.buffer)
      writeVLQ(writer, bytes.length)
      for (const byte of bytes) {
        writer.write(byte, 8)
      }
    }
  }

  return base64urlEncode(writer.toBytes())
}

export async function encodePGN(pgn: string, options: EncodeOptions = {}): Promise<string> {
  return withChess(async (chess) => _encodePGN(chess, pgn, options))
}

export async function encodePGNWith(chess: ChessAdapter, pgn: string, options: EncodeOptions = {}): Promise<string> {
  return _encodePGN(chess, pgn, options)
}