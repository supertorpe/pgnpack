/**
 * Tag Codec - Efficient PGN tag encoding/decoding
 * 
 * Pre-processes tags by replacing tag names with single-character codes
 * and removes brackets and quotes. Uses null byte as separator.
 * 
 * Format in bitstream:
 *   [block_length: VLQ] - byte length of data
 *   [block_bytes: N×8] - raw preprocessed data
 */

const TAG_CODE_MAP: Record<string, string> = {
  Event: "E",
  Site: "S",
  Date: "D",
  Round: "R",
  White: "W",
  Black: "B",
  Result: "X",
  WhiteElo: "w",
  BlackElo: "b",
  ECO: "O",
  Opening: "o",
  Annotator: "A",
  Variant: "V",
  StudyName: "s",
  ChapterName: "c",
  WhiteFideId: "q",
  BlackFideId: "Q",
  WhiteTitle: "t",
  BlackTitle: "T",
  UTCDate: "u",
  UTCTime: "U",
  Source: "C",
  Orientation: "I",
}

const CODE_TAG_MAP: Record<string, string> = {}
for (const [tag, code] of Object.entries(TAG_CODE_MAP)) {
  CODE_TAG_MAP[code] = tag
}

let nextCode = 128

export function encodeTagsBlock(tagsBlock: string): { bytes: Uint8Array; length: number } {
  const preprocessed = preprocessTags(tagsBlock)
  const bytes = new Uint8Array(preprocessed.length)
  for (let i = 0; i < preprocessed.length; i++) {
    bytes[i] = preprocessed.charCodeAt(i) & 0xFF
  }
  return { bytes, length: bytes.length }
}

export function decodeTagsBlock(bytes: Uint8Array, length: number): string {
  let preprocessed = ""
  for (let i = 0; i < length; i++) {
    preprocessed += String.fromCharCode(bytes[i])
  }
  return postprocessTags(preprocessed)
}

function preprocessTags(tagsBlock: string): string {
  let result = ""
  const tagRegex = /\[(\w+)\s+"([^"]*)"\]/g
  let match

  while ((match = tagRegex.exec(tagsBlock)) !== null) {
    const tagName = match[1]
    const tagValue = match[2]
    const code = TAG_CODE_MAP[tagName]

    if (code) {
      result += code + "\x00" + tagValue + "\x00"
    } else {
      const unknownCode = String.fromCharCode(nextCode++)
      TAG_CODE_MAP[tagName] = unknownCode
      CODE_TAG_MAP[unknownCode] = tagName
      result += unknownCode + "\x00" + tagValue + "\x00"
    }
  }

  return result
}

function postprocessTags(preprocessed: string): string {
  let result = ""
  const parts = preprocessed.split("\x00")
  
  for (let i = 0; i < parts.length - 1; i += 2) {
    const code = parts[i]
    const value = parts[i + 1]
    const tagName = CODE_TAG_MAP[code] || ""
    
    if (tagName && value !== undefined) {
      result += `[${tagName} "${value}"]\n`
    }
  }

  return result
}
