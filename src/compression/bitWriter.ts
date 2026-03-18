/**
 * BitWriter - Accumulates individual bits and converts them to bytes
 * 
 * Used for writing variable-length bit sequences that represent encoded chess moves.
 * Bits are stored in an array and later packed into bytes for base64url encoding.
 */

export class BitWriter {

  // Stores individual bits (0 or 1) that will be packed into bytes
  private bits:number[] = []

  /**
   * Writes a value using the specified number of bits (big-endian order)
   * @param value - The numeric value to write
   * @param size - Number of bits to use for the value
   */
  write(value:number, size:number){

    // Write bits from most significant to least significant
    for(let i=size-1;i>=0;i--){
      this.bits.push((value>>i)&1)
    }

  }

  /**
   * Packs the accumulated bits into bytes (8 bits per byte)
   * @returns Uint8Array of packed bytes
   */
  toBytes():Uint8Array{

    const bytes:number[] = []

    // Process bits 8 at a time
    for(let i=0;i<this.bits.length;i+=8){

      // Combine 8 consecutive bits into a single byte
      let b = 0

      for(let j=0;j<8;j++){
        b = (b<<1) | (this.bits[i+j] ?? 0)
      }

      bytes.push(b)

    }

    return Uint8Array.from(bytes)

  }

}
