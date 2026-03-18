/**
 * Variable Length Quantity (VLQ) encoding utilities
 * 
 * VLQ encodes integers into a variable number of bytes. Each byte uses 7 bits
 * for data and 1 bit as a continuation flag. This is efficient for values
 * of unknown or variable magnitude (like move counts, string lengths).
 * 
 * Also provides signed VLQ using zigzag encoding for handling negative numbers.
 */

import { BitWriter } from "./bitWriter"
import { BitReader } from "./bitReader"

/**
 * Writes aVLQ-encoded integer to the bit writer
 * 
 * Encodes value using multiple bytes: continuation bit (bit 7) indicates
 * if more bytes follow. Lower 7 bits of each byte hold the data.
 * @param writer - BitWriter to write to
 * @param value - Non-negative integer to encode
 */
export function writeVLQ(writer:BitWriter,value:number){

  // Write continuation bytes while value needs more than 7 bits
  while(value >= 0x80){
    // Set continuation bit, write lower 7 bits
    writer.write((value & 0x7F) | 0x80,8)
    value >>=7
  }

  // Write final byte (continuation bit = 0)
  writer.write(value,8)

}

/**
 * Reads aVLQ-encoded integer from the bit reader
 * @param reader - BitReader to read from
 * @returns Decoded integer
 */
export function readVLQ(reader:BitReader){

  let value = 0
  let shift = 0

  // Read bytes until continuation bit is 0
  while(true){

    const byte = reader.read(8)

    // Combine lower 7 bits at appropriate shift position
    value |= (byte & 0x7F) << shift

    // If continuation bit is clear, we're done
    if((byte & 0x80) === 0)
      break

    shift += 7
  }

  return value
}

// Zigzag encoding maps signed integers to unsigned while preserving order.
// This allows efficient storage of negative numbers using unsigned VLQ.
/**
 * Zigzag encoding: maps signed integers to unsigned for VLQ
 * @param value - Signed integer
 * @returns Unsigned integer
 */
function zigzagEncode(value:number):number{
  return (value << 1) ^ (value >> 31)
}

/**
 * Zigzag decoding: reverses zigzag encoding
 * @param value - Unsigned integer
 * @returns Signed integer
 */
function zigzagDecode(value:number):number{
  return (value >>> 1) ^ -(value & 1)
}

/**
 * Writes a signed integer using VLQ (via zigzag encoding)
 * @param writer - BitWriter to write to
 * @param value - Signed integer to encode
 */
export function writeSignedVLQ(writer:BitWriter,value:number){
  writeVLQ(writer,zigzagEncode(value))
}

/**
 * Reads a signed integer using VLQ (via zigzag decoding)
 * @param reader - BitReader to read from
 * @returns Decoded signed integer
 */
export function readSignedVLQ(reader:BitReader):number{
  return zigzagDecode(readVLQ(reader))
}
