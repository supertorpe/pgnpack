/**
 * BitReader - Reads individual bits from a byte array
 * 
 * The inverse of BitWriter: unpacks bytes back into bits and provides methods
 * to read variable-length bit sequences. Used to decode compressed PGN data.
 */

export class BitReader {

  // Array of individual bits unpacked from bytes
  bits:number[] = []
  // Current reading position
  pos = 0

  /**
   * Constructs a BitReader by unpacking bytes into individual bits
   * @param bytes - Uint8Array of encoded data
   */
  constructor(bytes:Uint8Array){

    // Convert each byte into 8 bits (most significant bit first)
    for(const b of bytes){

      for(let i=7;i>=0;i--){
        this.bits.push((b>>i)&1)
      }

    }

  }

  /**
   * Reads the specified number of bits and advances the position
   * @param size - Number of bits to read
   * @returns The numeric value read
   */
  read(size:number){

    let v = 0

    for(let i=0;i<size;i++){
      v = (v<<1) | this.bits[this.pos++]
    }

    return v
  }

}
