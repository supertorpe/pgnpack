/**
 * Base64url encoding and decoding utilities
 * 
 * URL-safe variant of Base64 that replaces + with - and / with _,
 * and removes padding characters (=). This produces shorter, URL-safe strings.
 */

/**
 * Encodes bytes to a URL-safe Base64 string
 * @param bytes - Uint8Array to encode
 * @returns Base64url encoded string
 */
export function base64urlEncode(bytes: Uint8Array): string {
  // Convert bytes to binary string for btoa
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)

  // Use btoa to encode, then make URL-safe by removing padding
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/**
 * Decodes a Base64url string back to bytes
 * @param str - Base64url encoded string
 * @returns Decoded Uint8Array
 */
export function base64urlDecode(str: string): Uint8Array {
  // Restore standard Base64 characters and add padding
  str = str.replace(/-/g, "+").replace(/_/g, "/")

  while (str.length % 4) str += "="

  // Decode and convert back to bytes
  const bin = atob(str)

  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
