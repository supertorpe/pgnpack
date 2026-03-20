/**
 * PGN Decoder - Decompresses base64url strings back to PGN format
 *
 * Uses custom encoding with move ordering and compressed metadata blocks.
 *
 * Header format (2 bits):
 *   Bit 1: hasTags
 *   Bit 2: hasAnnotations
 */

import { withChess, ChessAdapter } from "../chess/adapter"
import { BitReader } from "../compression/bitReader"
import { base64urlDecode } from "../compression/base64url"
import { orderMoves } from "../chess/moveOrdering"
import { readVLQ } from "../compression/vlq"
import LZString from "lz-string"
import { decodeTagsBlock } from "../codec/tagCodec"

/**
 * Core decoding logic - used by both decodePGN and decodePGNWith
 */
async function _decodePGN(chess: ChessAdapter, code: string): Promise<string> {
  chess.reset()
  const bytes = base64urlDecode(code)

  const reader = new BitReader(bytes)

  const hasTags = reader.read(1) === 1
  const hasAnnotations = reader.read(1) === 1

  if (!hasTags && !hasAnnotations) {
    return decodeMoves(reader, chess)
  }

  return decodeCustom(reader, chess, hasTags, hasAnnotations)
}

async function decodeCustom(reader: BitReader, chess: ChessAdapter, hasTags: boolean, hasAnnotations: boolean): Promise<string> {
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

async function decodeMoves(reader: BitReader, chess: ChessAdapter): Promise<string> {
  chess.reset()

  const totalMoves = readVLQ(reader)

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
