/**
 * CLI Helpers - Utility functions for argument parsing
 */

import type { CommandResult, CommandConfig } from '../types.js';

/**
 * Extract numeric flag from arguments
 */
export function extractFlag(args: string[], flag: string, defaultValue: number): number {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return parseFloat(args[idx + 1]) || defaultValue;
  }
  return defaultValue;
}

/**
 * Extract string flag from arguments
 */
export function extractStringFlag(args: string[], flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

/**
 * Check if flag exists in arguments
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/**
 * Format output based on config (JSON or human-readable)
 */
export function formatOutput(result: CommandResult, config: CommandConfig): void {
  if (config.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      if (typeof result.data === 'string') {
        console.log(result.data);
      } else if (result.data) {
        console.log(result.data);
      }
    } else {
      console.error(`Error: ${result.error}`);
    }
  }
}
