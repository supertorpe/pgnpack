/**
 * PGN Decoder - Decompresses base64url strings back to PGN format
 * 
 * Inverse of the encoder:
 * 1. Decode base64url to bytes
 * 2. Unpack bytes to bits
 * 3. Read header flag (compact vs full mode)
 * 4. Read and decompress tags (if present)
 * 5. For each move:
 *    a. Reconstruct legal moves using same ordering as encoder
 *    b. Read index and look up the actual move
 *    c. Read and decompress post-text (annotations) if in full mode
 *    d. Reconstruct PGN move notation with move numbers
 * 6. Combine tags and moves into final PGN string
 */

import { withChess, ChessAdapter } from "../chess/adapter"
import { BitReader } from "../compression/bitReader"
import { base64urlDecode } from "../compression/base64url"
import { orderMoves } from "../chess/moveOrdering"
import { readVLQ } from "../compression/vlq"
import { decompress } from "smol-string"
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
  chess.reset()
  const bytes = base64urlDecode(code)

  const reader = new BitReader(bytes)

  const compact = reader.read(1) === 1

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
    if (!compact) {
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
        postText = compressed ? decompress(compressed) || "" : ""
      }
    }

    const moveStr = isWhite ? `${moveNumber}. ${move.san}` : move.san

    let fullMove = moveStr

    if (!compact && postText) {
      fullMove = `${moveStr} ${postText}`
    }

    moves.push(fullMove)

    if (!isWhite) moveNumber++
    isWhite = !isWhite
    chess.move(move.san)
  }

  if (!compact && tagsBlock) {
    return tagsBlock + "\n\n" + moves.join(" ")
  }
  return moves.join(" ")
}

export async function decodePGN(code: string): Promise<string> {
  return withChess(async (chess) => _decodePGN(chess, code))
}

export async function decodePGNWith(chess: ChessAdapter, code: string): Promise<string> {
  return _decodePGN(chess, code)
}