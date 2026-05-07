/**
 * Shared constants used throughout the pgnpack library.
 * 
 * Version history:
 * - v1: Original format with marker-based variations (deprecated)
 * - v2: Length-prefixed variations for robust decoding
 */

export const CURRENT_VERSION = 2
export const MIN_COMPATIBLE_VERSION = 2

// V2 format doesn't use these legacy constants
export const VARIATION_START = -1
export const VARIATION_END = -2