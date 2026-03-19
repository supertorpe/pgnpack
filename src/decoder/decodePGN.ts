/**
 * PGN Decoder - Decompresses base64url strings back to PGN format
 * 
 * Handles two encoding methods:
 * 1. Custom encoding (move ordering + tag compression)
  * 2. lz-string fallback (when it produces shorter result)
  * 
  * Header format (2 bits):
  *   00 = compact (moves only)
  *   01 = custom encoding with metadata
  *   10 = lz-string compressed
 */

import { withChess, ChessAdapter } from "../chess/adapter"
import { BitReader } from "../compression/bitReader"
import { base64urlDecode } from "../compression/base64url"
import { orderMoves } from "../chess/moveOrdering"
import { readVLQ } from "../compression/vlq"
import LZString from "lz-string"
import { decodeTagsBlock } from "../codec/tagCodec"

/**
 * Decodes a compact PGN string back to human-readable PGN
 * 
 * Uses auto-detected chess library to reconstruct moves.
 * @param code - Base64url encoded string
 * @returns Human-readable PGN string
 */
/**
 * Core decoding logic - used by both decodePGN and decodePGNWith
 */
async function _decodePGN(chess: ChessAdapter, code: string): Promise<string> {
  if (code.startsWith("lz_")) {
    const compressed = code.slice(3)
    return LZString.decompressFromEncodedURIComponent(compressed) || ""
  }

  chess.reset()
  const bytes = base64urlDecode(code)

  const reader = new BitReader(bytes)

  const header = reader.read(2)

  if (header === 0) {
    return decodeMoves(reader, chess)
  }

  if (header === 2) {
    return decodeLz(reader, chess)
  }

  return decodeCustom(reader, chess)
}

async function decodeLz(reader: BitReader, _chess: ChessAdapter): Promise<string> {
  const bytes: number[] = []
  while (reader.pos < reader.bits.length) {
    bytes.push(reader.read(8))
  }
  let compressed = ""
  for (const byte of bytes) {
    compressed += String.fromCharCode(byte)
  }
  return LZString.decompressFromEncodedURIComponent(compressed) || ""
}

async function decodeCustom(reader: BitReader, chess: ChessAdapter): Promise<string> {
  chess.reset()

  const blockLength = readVLQ(reader)
  let tagsBlock = ""
  if (blockLength > 0) {
    const tagBytes = new Uint8Array(blockLength)
    for (let i = 0; i < blockLength; i++) {
      tagBytes[i] = reader.read(8)
    }
    tagsBlock = decodeTagsBlock(tagBytes, blockLength)
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

    let postText = ""
    {
      const postLength = readVLQ(reader)
      if (postLength > 0) {
        const bytes = new Uint8Array(postLength)
        for (let j = 0; j < postLength; j++) {
          bytes[j] = reader.read(8)
        }
        const charCodes = new Uint16Array(bytes.buffer)
        let compressed = ""
        for (let k = 0; k < charCodes.length; k++) {
          compressed += String.fromCharCode(charCodes[k])
        }
        postText = compressed ? LZString.decompressFromUTF16(compressed) || "" : ""
      }
    }

    const moveStr = isWhite ? `${moveNumber}. ${move.san}` : move.san

    let fullMove = moveStr

    if (postText) {
      fullMove = `${moveStr} ${postText}`
    }

    moves.push(fullMove)

    if (!isWhite) moveNumber++
    isWhite = !isWhite
    chess.move(move.san)
  }

  if (tagsBlock) {
    return tagsBlock + "\n\n" + moves.join(" ")
  }
  return moves.join(" ")
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