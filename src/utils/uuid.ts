/**
 * UUID Generation Utilities
 * @module utils/uuid
 */

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import type { UUID } from '../types/index.js';

/**
 * Generate a new UUID v4
 * @returns UUID string
 */
export function generateUUID(): UUID {
  return uuidv4();
}

/**
 * Validate a UUID string
 * @param str - String to validate
 * @returns true if valid UUID
 */
export function isValidUUID(str: string): boolean {
  return uuidValidate(str);
}

/**
 * Generate multiple UUIDs
 * @param count - Number of UUIDs to generate
 * @returns Array of UUID strings
 */
export function generateUUIDs(count: number): UUID[] {
  return Array.from({ length: count }, () => uuidv4());
}
