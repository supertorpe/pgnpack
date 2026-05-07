import { MoveNode } from "../types"

function extractMoveText(pgn: string): string {
  const lines = pgn.split("\n")

  // Truncate at the next game in multi-game PGN
  let endIndex = lines.length
  let eventCount = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith("[Event")) {
      eventCount++
      if (eventCount > 1) {
        endIndex = i
        break
      }
    }
  }

  let headerEndIndex = 0
  for (let i = 0; i < endIndex; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === "") continue
    if (!trimmed.startsWith("[")) {
      headerEndIndex = i
      break
    }
  }

  const gameLines = lines.slice(headerEndIndex, endIndex)
  const preludeSection = gameLines.join(" ")

  // Strip {...} comments before finding first move to avoid matching inside annotations
  const stripped = preludeSection.replace(/\{[^}]*\}/g, (m) => " ".repeat(m.length))
  const firstMoveMatch = stripped.match(/(\d+\.+\s*(?:[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*)|(?:^|\s)(?:[KQRBNP][a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*)\s)/)
  if (firstMoveMatch && firstMoveMatch.index !== undefined) {
    return preludeSection.slice(firstMoveMatch.index)
  }

  return preludeSection
}

/**
 * Scan a block comment { ... } and return its content (including braces)
 * Returns null if no block comment found
 */
function scanBlockComment(text: string, startIndex: number): { content: string; endIndex: number } | null {
  if (text[startIndex] !== "{") return null
  const commentEnd = text.indexOf("}", startIndex + 1)
  if (commentEnd === -1) return null
  return { content: text.slice(startIndex, commentEnd + 1), endIndex: commentEnd + 1 }
}

/**
 * Scan a NAG $... and return its content
 * Returns null if no NAG found
 */
function scanNag(text: string, startIndex: number): { content: string; endIndex: number } | null {
  if (text[startIndex] !== "$") return null
  const match = text.slice(startIndex).match(/^\$\d+/)
  if (!match) return null
  return { content: match[0], endIndex: startIndex + match[0].length }
}

function countParentheses(text: string): { open: number; close: number } {
  let open = 0
  let close = 0
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{") { inBlock = true; continue }
    if (ch === "}") { inBlock = false; continue }
    if (inBlock) continue
    if (ch === "(") open++
    else if (ch === ")") close++
  }
  return { open, close }
}

function isMoveNumber(text: string, index: number): boolean {
  let i = index
  while (i < text.length && (text[i] >= '0' && text[i] <= '9')) {
    i++
  }
  if (i > index && text[i] === '.') {
    let j = i + 1
    let dotCount = 1
    while (j < text.length && text[j] === '.') {
      dotCount++
      j++
    }
    if (dotCount <= 2) {
      return true
    }
  }
  return false
}

function skipMoveNumber(text: string, index: number): number {
  let i = index
  while (i < text.length && (text[i] >= '0' && text[i] <= '9')) {
    i++
  }
  if (i > index && text[i] === '.') {
    let j = i + 1
    while (j < text.length && text[j] === '.') {
      j++
    }
    return j
  }
  return index
}

const moveRegex = /^([KQRBNP][a-h]?[1-8]?x?[a-h][1-8](?:\=[KQRBNP])?[+#]*|0-0-0[+#]*|0-0[+#]*|O-O-O[+#]*|O-O[+#]*|[a-h]x[a-h][1-8](?:\=[KQRBNP])?[+#]*|[a-h][1-8](?:\=[KQRBNP]|[KQRBNP](?=[+#]|\s|$))?[+#]*)/

/**
 * Parse a single move from text at the given index
 */
function parseSingleMove(text: string, index: number): { san: string; consumed: number } | null {
  const remaining = text.slice(index)
  const match = remaining.match(moveRegex)
  if (match) {
    return { san: match[1], consumed: match[1].length }
  }
  return null
}

/**
 * Find the matching closing parenthesis for an opening at startIndex
 */
function findMatchingParen(text: string, startIndex: number): number {
  let depth = 1
  let i = startIndex
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    if (depth > 0) i++
  }
  return i
}

/**
 * Parse moves from text, building a tree with variations
 * 
 * PGN variation semantics:
 * - A variation appearing after a move is an alternative to the NEXT move(s)
 * - Nested variations work the same way
 * - Annotations ({...}, $..., ;...) are extracted and stored in postText
 *   on the MoveNode they follow
 */
function parseMovesWithVariations(text: string): MoveNode[] {
  const moves: MoveNode[] = []
  let i = 0
  let pendingVariations: MoveNode[] = []
  let pendingAnnotations: string[] = []

  while (i < text.length) {
    const ch = text[i]

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++
      continue
    }

    // Skip move numbers
    if (isMoveNumber(text, i)) {
      i = skipMoveNumber(text, i)
      continue
    }

    // Handle block comment { ... }
    if (ch === '{') {
      const comment = scanBlockComment(text, i)
      if (comment) {
        pendingAnnotations.push(comment.content)
        i = comment.endIndex
        continue
      }
      i++
      continue
    }

    // Handle NAG $...
    if (ch === '$') {
      const nag = scanNag(text, i)
      if (nag) {
        pendingAnnotations.push(nag.content)
        i = nag.endIndex
        continue
      }
      i++
      continue
    }

    // Handle opening paren - collect nested variation
    if (ch === '(') {
      const closeIndex = findMatchingParen(text, i + 1)
      const variationContent = text.slice(i + 1, closeIndex)

      // Parse the nested variation content
      const nestedVariationMoves = parseMovesWithVariations(variationContent)

      // Chain the nested variation moves: each move's variations array contains the next move
      // This creates a linked list where variations[0] is the continuation of the line
      if (nestedVariationMoves.length > 0) {
        for (let j = 0; j < nestedVariationMoves.length - 1; j++) {
          nestedVariationMoves[j].variations.push(nestedVariationMoves[j + 1])
        }
        // Add the first move of the nested variation to pending
        // The rest of the line is accessible via variations[0] chain
        pendingVariations.push(nestedVariationMoves[0])
      }

      i = closeIndex + 1
      continue
    }

    // Skip closing paren
    if (ch === ')') {
      break
    }

    // Try to parse a move
    const moveResult = parseSingleMove(text, i)
    if (moveResult) {
      // Flush pending annotations to the PREVIOUS move
      if (moves.length > 0 && pendingAnnotations.length > 0) {
        const prevMove = moves[moves.length - 1]
        const existing = prevMove.postText ? prevMove.postText + " " : ""
        prevMove.postText = existing + pendingAnnotations.join(" ")
        pendingAnnotations = []
      }

      // Attach pending variations to the PREVIOUS move
      if (moves.length > 0 && pendingVariations.length > 0) {
        const prevMove = moves[moves.length - 1]
        prevMove.variations.push(...pendingVariations)
        pendingVariations = []
      }

      const move: MoveNode = { san: moveResult.san, postText: "", variations: [] }
      moves.push(move)
      i += moveResult.consumed
    } else {
      i++
    }
  }

  // Flush remaining pending annotations to the last move
  if (moves.length > 0 && pendingAnnotations.length > 0) {
    const prevMove = moves[moves.length - 1]
    const existing = prevMove.postText ? prevMove.postText + " " : ""
    prevMove.postText = existing + pendingAnnotations.join(" ")
  }

  // Attach any remaining pending variations to the last move
  if (moves.length > 0 && pendingVariations.length > 0) {
    const prevMove = moves[moves.length - 1]
    prevMove.variations.push(...pendingVariations)
  }

  return moves
}

export function parseRavTree(pgn: string): MoveNode[] {
  if (!pgn || pgn.trim() === "") {
    return []
  }

  const moveText = extractMoveText(pgn)
  if (!moveText.trim()) {
    return []
  }

  const parenCount = countParentheses(moveText)
  if (parenCount.open !== parenCount.close) {
    throw new Error(`Unbalanced parentheses: ${parenCount.open} opening, ${parenCount.close} closing`)
  }

  return parseMovesWithVariations(moveText)
}
