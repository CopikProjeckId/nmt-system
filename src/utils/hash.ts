/**
 * SHA3-256 Hashing Utilities
 * @module utils/hash
 */

import sha3 from 'js-sha3';
const { sha3_256 } = sha3;
import type { SHA3Hash } from '../types/index.js';

/**
 * Compute SHA3-256 hash of data
 * @param data - Buffer or string to hash
 * @returns 64-character hex hash string
 */
export function hash(data: Buffer | string): SHA3Hash {
  if (Buffer.isBuffer(data)) {
    return sha3_256(data);
  }
  return sha3_256(data);
}

/**
 * Compute SHA3-256 hash of combined data
 * Used for Merkle tree pair hashing
 * @param a - First hash
 * @param b - Second hash
 * @returns Combined hash (sorted to ensure consistency)
 */
export function hashPair(a: SHA3Hash, b: SHA3Hash): SHA3Hash {
  // Sort to ensure deterministic ordering
  const [left, right] = a < b ? [a, b] : [b, a];
  return sha3_256(left + right);
}

/**
 * Verify a hash matches the data
 * @param data - Original data
 * @param expectedHash - Expected hash value
 * @returns true if hash matches
 */
export function verifyHash(data: Buffer | string, expectedHash: SHA3Hash): boolean {
  return hash(data) === expectedHash;
}

/**
 * Compute hash of JSON object
 * @param obj - Object to hash
 * @returns SHA3-256 hash of JSON string
 */
export function hashObject(obj: unknown): SHA3Hash {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  return hash(json);
}

/**
 * Check if a string is a valid SHA3-256 hash
 * @param str - String to check
 * @returns true if valid 64-character hex string
 */
export function isValidHash(str: string): boolean {
  return /^[a-f0-9]{64}$/i.test(str);
}
