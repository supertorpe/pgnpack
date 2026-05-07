/**
 * PGN Decoder - Decompresses base64url strings back to PGN format
 *
 * Uses custom encoding with move ordering and compressed metadata blocks.
 *
 * Header format:
 *   Version (VLQ) | Flags (2 bits)
 *   Bit 1: hasTags
 *   Bit 2: hasAnnotations
 *
 * V2 Format - Variation encoding:
 *   - 1 bit position flag (0=after, 1=before parent move)
 *   - 10 bits length prefix (up to 1024 bytes)
 *   - Variation content as byte-aligned bit stream
 */

import { withChess, ChessAdapter } from "../chess/adapter"
import { BitReader } from "../compression/bitReader"
import { base64urlDecode } from "../compression/base64url"
import { orderMoves } from "../chess/moveOrdering"
import { readVLQ } from "../compression/vlq"
import LZString from "lz-string"
import { decodeTagsBlock } from "../codec/tagCodec"
import { CURRENT_VERSION, MIN_COMPATIBLE_VERSION } from "../constants"
import { MoveNode } from "../types"
import { renderRavTree } from "./ravRenderer"

/**
 * Detects if the encoding uses tree format (with variations)
 */
function detectTreeEncoding(reader: BitReader, chess: ChessAdapter): boolean {
  const savedPos = reader.pos
  chess.reset()

  for (let attempt = 0; attempt < 3; attempt++) {
    const ordered = orderMoves(chess)
    if (ordered.length < 2) break

    const flatBits = Math.ceil(Math.log2(ordered.length))
    const treeBits = Math.ceil(Math.log2(ordered.length + 2))

    if (flatBits === treeBits) {
      if (reader.pos + treeBits > reader.bits.length) break
      const index = reader.read(treeBits)

      if (index >= ordered.length) {
        reader.pos = savedPos
        chess.reset()
        return true
      }

      chess.move(ordered[index].san)
    } else {
      break
    }
  }

  reader.pos = savedPos
  chess.reset()
  return false
}

/**
 * Decodes a move tree from the bitstream
 * 
 * V2 format uses length-prefixed variations:
 * - 1 bit position flag (0=after, 1=before)
 * - 10 bits length (up to 1024 bytes)
 * - Variation content as bytes
 */
async function decodeMoveTree(
  reader: BitReader,
  chess: ChessAdapter,
  annotationsBlock: string[] = [],
  depth: number = 0
): Promise<{ tree: MoveNode[]; usedAnnotations: number }> {
  const tree: MoveNode[] = []
  let annotationIndex = 0
  const markerCount = 2
  const LENGTH_BITS = 10

  while (reader.pos < reader.bits.length) {
    const ordered = orderMoves(chess)
    if (!ordered.length) break

    const bits = Math.ceil(Math.log2(ordered.length + markerCount))
    if (reader.pos + bits > reader.bits.length) break

    const index = reader.read(bits)

    // Check for end-of-tree marker (single bit at root level)
    if (index >= ordered.length) {
      break
    }

    const move = ordered[index]
    const postText = annotationsBlock[annotationIndex] || ""
    annotationIndex++

    const fenBeforeMove = chess.fen()

    tree.push({ san: move.san, postText, variations: [] })
    chess.move(move.san)

    const fenAfterMove = chess.fen()

    // Read number of variations (4 bits)
    const numVariations = reader.read(4)
    
    // Decode each variation
    for (let v = 0; v < numVariations; v++) {
      // Read position flag
      const fromBefore = reader.read(1) === 1

      // Read length (10 bits)
      const length = reader.read(LENGTH_BITS)

      // Read variation bytes
      if (reader.pos + length * 8 > reader.bits.length) break
      const variationBytes = new Uint8Array(length)
      for (let i = 0; i < length; i++) {
        variationBytes[i] = reader.read(8)
      }

      // Create temporary reader for variation
      const tempReader = new BitReader(variationBytes)

      // Load correct position and decode variation (flat encoding)
      chess.load(fromBefore ? fenBeforeMove : fenAfterMove)
      const result = await decodeMoveTreeFlat(tempReader, chess, annotationsBlock, depth + 1)

      if (tree.length > 0 && result.tree.length > 0) {
         // Add all moves from the flat variation as a single variation tree
         for (let j = 0; j < result.tree.length - 1; j++) {
           result.tree[j].variations = [result.tree[j + 1]]
         }
         tree[tree.length - 1].variations.push(result.tree[0])
       }
      annotationIndex += result.usedAnnotations

      // Restore position after parent move
      chess.load(fenAfterMove)
    }
  }

  return { tree, usedAnnotations: annotationIndex }
}

/**
 * Decodes a FLAT move tree (no sub-variations) from the bitstream
 * Used for decoding variations that were encoded as flat sequences
 */
async function decodeMoveTreeFlat(
  reader: BitReader,
  chess: ChessAdapter,
  annotationsBlock: string[] = [],
  _depth: number = 0
): Promise<{ tree: MoveNode[]; usedAnnotations: number }> {
  const tree: MoveNode[] = []
  let annotationIndex = 0
  const markerCount = 2
  const LENGTH_BITS = 10

  while (reader.pos < reader.bits.length) {
    const ordered = orderMoves(chess)
    if (!ordered.length) break

    const bits = Math.ceil(Math.log2(ordered.length + markerCount))
    if (reader.pos + bits > reader.bits.length) break

    const index = reader.read(bits)

    // Check for end-of-tree marker
    if (index >= ordered.length) {
      break
    }

    const move = ordered[index]
    const postText = annotationsBlock[annotationIndex] || ""
    annotationIndex++

    tree.push({ san: move.san, postText, variations: [] })
    chess.move(move.san)

    const fenAfterMove = chess.fen()

    // Read and skip variation count (4 bits) - flat encoding has no sub-variations
    const numVariations = reader.read(4)
    // Skip any variation data if present (shouldn't be in flat encoding)
    for (let v = 0; v < numVariations; v++) {
      reader.read(1) // position flag
      const length = reader.read(LENGTH_BITS)
      reader.pos += length * 8 // skip variation bytes
    }

    chess.load(fenAfterMove)
  }

  return { tree, usedAnnotations: annotationIndex }
}

/**
 * Core decoding logic
 */
async function _decodePGN(chess: ChessAdapter, code: string): Promise<string> {
  chess.reset()
  const bytes = base64urlDecode(code)
  const reader = new BitReader(bytes)

  const version = readVLQ(reader)
  if (version < MIN_COMPATIBLE_VERSION || version > CURRENT_VERSION) {
    throw new Error(
      `Incompatible format version: ${version}. ` +
      `Supported versions: ${MIN_COMPATIBLE_VERSION} to ${CURRENT_VERSION}.`
    )
  }

  const hasTags = reader.read(1) === 1
  const hasAnnotations = reader.read(1) === 1
  const hasVariations = reader.read(1) === 1

  if (!hasTags && !hasAnnotations) {
    return decodeMoves(reader, chess, hasVariations)
  }

  return decodeCustom(reader, chess, hasTags, hasAnnotations, hasVariations)
}

async function decodeCustom(
  reader: BitReader,
  chess: ChessAdapter,
  hasTags: boolean,
  hasAnnotations: boolean,
  hasVariations: boolean = false
): Promise<string> {
  chess.reset()

  let tagsBlock = ""
  if (hasTags) {
    const blockLength = readVLQ(reader)
    if (blockLength > 0) {
      const tagBytes = new Uint8Array(blockLength)
      for (let i = 0; i < blockLength; i++) {
        tagBytes[i] = reader.read(8)
      }
      tagsBlock = decodeTagsBlock(tagBytes, blockLength)
    }
  }

  let preludeBlock = ""
  if (hasAnnotations) {
    const preludeLength = readVLQ(reader)
    if (preludeLength > 0) {
      const preludeBytes = new Uint8Array(preludeLength)
      for (let i = 0; i < preludeLength; i++) {
        preludeBytes[i] = reader.read(8)
      }
      const preludeCompressed = new TextDecoder().decode(preludeBytes)
      preludeBlock = preludeCompressed ? LZString.decompressFromEncodedURIComponent(preludeCompressed) || "" : ""
    }
  }

  let annotationsBlock: string[] = []
  if (hasAnnotations) {
    const annotationsLength = readVLQ(reader)
    if (annotationsLength > 0) {
      const annotationsBytes = new Uint8Array(annotationsLength)
      for (let i = 0; i < annotationsLength; i++) {
        annotationsBytes[i] = reader.read(8)
      }
      const annotationsCompressed = new TextDecoder().decode(annotationsBytes)
      const annotationsStr = annotationsCompressed ? LZString.decompressFromEncodedURIComponent(annotationsCompressed) || "" : ""
      annotationsBlock = annotationsStr ? annotationsStr.split("\x00") : []
    }
  }

  const totalMoves = readVLQ(reader)

  // Use tree encoding if hasVariations flag is set or if totalMoves is 0
  const isTreeEncoding = hasVariations || totalMoves === 0

  if (isTreeEncoding) {
    // For v2 format, tree is length-prefixed
    const treeLength = totalMoves === 0 ? readVLQ(reader) : totalMoves
    
    // Read tree bytes
    const treeBytes = new Uint8Array(treeLength)
    for (let i = 0; i < treeLength; i++) {
      treeBytes[i] = reader.read(8)
    }
    
    // Create temporary reader for tree
    const treeReader = new BitReader(treeBytes)
    
    chess.reset()
    const treeResult = await decodeMoveTree(treeReader, chess, annotationsBlock)

    if (treeResult.tree.length > 0) {
      const renderedMoves = renderRavTree(treeResult.tree)

      let result = tagsBlock.trimEnd()
      if (preludeBlock) {
        result += (result ? "\n\n" : "") + preludeBlock
      }
      if (renderedMoves) {
        result += (result ? "\n\n" : "") + renderedMoves
      }
      return result
    }
  }

  // Flat encoding (no variations)
  chess.reset()
  const moves: string[] = []
  let moveNumber = 1
  let isWhite = true

  for (let i = 0; i < totalMoves; i++) {
    const ordered = orderMoves(chess)
    if (!ordered.length) break

    const bits = Math.ceil(Math.log2(ordered.length))
    if (reader.pos + bits > reader.bits.length) break

    const index = reader.read(bits)
    if (index >= ordered.length) break

    const move = ordered[index]
    const moveStr = isWhite ? `${moveNumber}. ${move.san}` : move.san

    let fullMove = moveStr
    const postText = annotationsBlock[i] || ""
    if (postText) {
      fullMove = `${moveStr} ${postText}`
    }

    moves.push(fullMove)

    if (!isWhite) moveNumber++
    isWhite = !isWhite
    chess.move(move.san)
  }

  let result = tagsBlock.trimEnd()
  if (preludeBlock) {
    result += (result ? "\n\n" : "") + preludeBlock
  }
  if (moves.length > 0) {
    result += (result ? "\n\n" : "") + moves.join(" ")
  }
  return result
}

async function decodeMoves(
  reader: BitReader,
  chess: ChessAdapter,
  hasVariations: boolean = false
): Promise<string> {
  chess.reset()
  const totalMoves = readVLQ(reader)

  const isTreeEncoding = hasVariations || (totalMoves === 0 && detectTreeEncoding(reader, chess))

  if (isTreeEncoding) {
    chess.reset()
    const treeResult = await decodeMoveTree(reader, chess)

    if (treeResult.tree.length > 0) {
      return renderRavTree(treeResult.tree)
    }
  }

  chess.reset()
  const moves: string[] = []
  let moveNumber = 1
  let isWhite = true

  for (let i = 0; i < totalMoves; i++) {
    const ordered = orderMoves(chess)
    if (!ordered.length) break

    const bits = Math.ceil(Math.log2(ordered.length))
    if (reader.pos + bits > reader.bits.length) break

    const index = reader.read(bits)
    if (index >= ordered.length) break

    const move = ordered[index]
    const moveStr = isWhite ? `${moveNumber}. ${move.san}` : move.san
    moves.push(moveStr)

    if (!isWhite) moveNumber++
    isWhite = !isWhite
    chess.move(move.san)
  }

  return moves.join(" ")
}

export async function decodePGN(code: string): Promise<string> {
  return withChess(async (chess) => _decodePGN(chess, code))
}

export async function decodePGNWith(chess: ChessAdapter, code: string): Promise<string> {
  return _decodePGN(chess, code)
}
