/**
 * CLI Input Validation Utilities
 *
 * Provides schema-based validation for CLI command arguments.
 * Ensures type safety and provides clear error messages.
 *
 * @module cli/utils/validators
 */

import type { CommandResult } from '../types.js';

/**
 * Validation error with field context
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Validation result
 */
export interface ValidationResult<T = Record<string, unknown>> {
  valid: boolean;
  errors: ValidationError[];
  data?: T;
}

/**
 * Field validator function type
 */
export type FieldValidator<T = unknown> = (value: unknown, fieldName: string) => {
  valid: boolean;
  error?: string;
  value?: T;
};

/**
 * Field schema definition
 */
export interface FieldSchema<T = unknown> {
  required?: boolean;
  type: 'string' | 'number' | 'boolean' | 'uuid' | 'embedding' | 'array';
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  enum?: T[];
  default?: T;
  validator?: FieldValidator<T>;
  description?: string;
}

/**
 * Command argument schema
 */
export type CommandSchema = Record<string, FieldSchema>;

// ==================== Built-in Validators ====================

/**
 * UUID format validator
 */
export const isValidUUID: FieldValidator<string> = (value, fieldName) => {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  // Accept standard UUID or short ID format (e.g., attr_abc123)
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const shortIdPattern = /^[a-zA-Z0-9_-]{3,50}$/;

  if (uuidPattern.test(value) || shortIdPattern.test(value)) {
    return { valid: true, value };
  }

  return { valid: false, error: `${fieldName} must be a valid ID` };
};

/**
 * Neuron ID validator (more permissive than UUID)
 */
export const isValidNeuronId: FieldValidator<string> = (value, fieldName) => {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  if (value.length < 1 || value.length > 100) {
    return { valid: false, error: `${fieldName} must be 1-100 characters` };
  }

  // Allow alphanumeric, underscores, hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return { valid: false, error: `${fieldName} contains invalid characters` };
  }

  return { valid: true, value };
};

/**
 * Numeric range validator factory
 */
export function numberInRange(min: number, max: number): FieldValidator<number> {
  return (value, fieldName) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;

    if (typeof num !== 'number' || isNaN(num)) {
      return { valid: false, error: `${fieldName} must be a number` };
    }

    if (num < min || num > max) {
      return { valid: false, error: `${fieldName} must be between ${min} and ${max}` };
    }

    return { valid: true, value: num };
  };
}

/**
 * Probability validator (0-1)
 */
export const isValidProbability = numberInRange(0, 1);

/**
 * Strength validator (0-1)
 */
export const isValidStrength = numberInRange(0, 1);

/**
 * Priority validator (1-10)
 */
export const isValidPriority = numberInRange(1, 10);

/**
 * Positive integer validator
 */
export const isPositiveInt: FieldValidator<number> = (value, fieldName) => {
  const num = typeof value === 'string' ? parseInt(value, 10) : value;

  if (typeof num !== 'number' || isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a number` };
  }

  if (!Number.isInteger(num) || num < 1) {
    return { valid: false, error: `${fieldName} must be a positive integer` };
  }

  return { valid: true, value: num };
};

/**
 * Non-empty string validator
 */
export const isNonEmptyString: FieldValidator<string> = (value, fieldName) => {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  return { valid: true, value: trimmed };
};

/**
 * ISO8601 date validator
 */
export const isValidDate: FieldValidator<string> = (value, fieldName) => {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return { valid: false, error: `${fieldName} must be a valid date (ISO8601)` };
  }

  return { valid: true, value: date.toISOString() };
};

// ==================== Schema Validation ====================

/**
 * Validate a single field against its schema
 */
function validateField(
  value: unknown,
  fieldName: string,
  schema: FieldSchema
): { valid: boolean; error?: string; value?: unknown } {
  // Handle missing values
  if (value === undefined || value === null || value === '') {
    if (schema.required) {
      return { valid: false, error: `${fieldName} is required` };
    }
    if (schema.default !== undefined) {
      return { valid: true, value: schema.default };
    }
    return { valid: true, value: undefined };
  }

  // Custom validator takes precedence
  if (schema.validator) {
    return schema.validator(value, fieldName);
  }

  // Type-based validation
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        return { valid: false, error: `${fieldName} must be a string` };
      }
      if (schema.minLength && value.length < schema.minLength) {
        return { valid: false, error: `${fieldName} must be at least ${schema.minLength} characters` };
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        return { valid: false, error: `${fieldName} must be at most ${schema.maxLength} characters` };
      }
      if (schema.pattern && !schema.pattern.test(value)) {
        return { valid: false, error: `${fieldName} has invalid format` };
      }
      if (schema.enum && !schema.enum.includes(value as never)) {
        return { valid: false, error: `${fieldName} must be one of: ${schema.enum.join(', ')}` };
      }
      return { valid: true, value };
    }

    case 'number': {
      const num = typeof value === 'string' ? parseFloat(value) : value;
      if (typeof num !== 'number' || isNaN(num)) {
        return { valid: false, error: `${fieldName} must be a number` };
      }
      if (schema.min !== undefined && num < schema.min) {
        return { valid: false, error: `${fieldName} must be at least ${schema.min}` };
      }
      if (schema.max !== undefined && num > schema.max) {
        return { valid: false, error: `${fieldName} must be at most ${schema.max}` };
      }
      return { valid: true, value: num };
    }

    case 'boolean': {
      if (typeof value === 'boolean') {
        return { valid: true, value };
      }
      if (value === 'true' || value === '1') {
        return { valid: true, value: true };
      }
      if (value === 'false' || value === '0') {
        return { valid: true, value: false };
      }
      return { valid: false, error: `${fieldName} must be a boolean` };
    }

    case 'uuid': {
      return isValidUUID(value, fieldName);
    }

    case 'array': {
      if (!Array.isArray(value)) {
        return { valid: false, error: `${fieldName} must be an array` };
      }
      if (schema.minLength && value.length < schema.minLength) {
        return { valid: false, error: `${fieldName} must have at least ${schema.minLength} items` };
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        return { valid: false, error: `${fieldName} must have at most ${schema.maxLength} items` };
      }
      return { valid: true, value };
    }

    default:
      return { valid: true, value };
  }
}

/**
 * Validate an object against a schema
 *
 * @param data - Object to validate
 * @param schema - Schema to validate against
 * @returns Validation result with errors or validated data
 *
 * @example
 * ```typescript
 * const schema = {
 *   neuronId: { type: 'uuid', required: true },
 *   strength: { type: 'number', min: 0, max: 1, default: 0.5 },
 *   name: { type: 'string', minLength: 1, maxLength: 100 }
 * };
 *
 * const result = validateSchema({ neuronId: 'abc123', strength: '0.8' }, schema);
 * if (result.valid) {
 *   console.log(result.data); // { neuronId: 'abc123', strength: 0.8 }
 * } else {
 *   console.log(result.errors);
 * }
 * ```
 */
export function validateSchema<T extends Record<string, unknown>>(
  data: Record<string, unknown>,
  schema: CommandSchema
): ValidationResult<T> {
  const errors: ValidationError[] = [];
  const validatedData: Record<string, unknown> = {};

  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    const result = validateField(data[fieldName], fieldName, fieldSchema);

    if (!result.valid) {
      errors.push({
        field: fieldName,
        message: result.error || `Invalid ${fieldName}`,
        value: data[fieldName]
      });
    } else if (result.value !== undefined) {
      validatedData[fieldName] = result.value;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? (validatedData as T) : undefined
  };
}

/**
 * Extract and validate arguments from CLI args array
 *
 * @param args - CLI argument array
 * @param schema - Schema defining expected arguments
 * @param positionalFields - Fields to extract positionally (in order)
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const schema = {
 *   neuronId: { type: 'uuid', required: true },
 *   depth: { type: 'number', min: 1, max: 20, default: 5 }
 * };
 *
 * const result = validateArgs(['neuron-123', '--depth', '10'], schema, ['neuronId']);
 * // result.data = { neuronId: 'neuron-123', depth: 10 }
 * ```
 */
export function validateArgs(
  args: string[],
  schema: CommandSchema,
  positionalFields: string[] = []
): ValidationResult {
  const data: Record<string, unknown> = {};

  // Extract positional arguments
  let positionalIndex = 0;
  for (let i = 0; i < args.length && positionalIndex < positionalFields.length; i++) {
    if (!args[i].startsWith('--')) {
      data[positionalFields[positionalIndex]] = args[i];
      positionalIndex++;
    }
  }

  // Extract flag arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const flagName = args[i].slice(2);
      const camelName = flagName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

      // Check if it's a boolean flag (no value) or has a value
      const nextArg = args[i + 1];
      if (nextArg === undefined || nextArg.startsWith('--')) {
        data[camelName] = true;
      } else {
        data[camelName] = nextArg;
        i++; // Skip the value
      }
    }
  }

  return validateSchema(data, schema);
}

/**
 * Create a validation error CommandResult
 */
export function validationError(errors: ValidationError[]): CommandResult {
  const errorMessages = errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
  return {
    success: false,
    error: `Validation failed:\n${errorMessages}`
  };
}

/**
 * Create a CommandResult for missing required argument
 */
export function missingArgError(argName: string, usage: string): CommandResult {
  return {
    success: false,
    error: `Missing required argument: ${argName}\nUsage: ${usage}`
  };
}

// ==================== Common Schemas ====================

/**
 * Common schema for neuron ID argument
 */
export const neuronIdSchema: FieldSchema = {
  type: 'uuid',
  required: true,
  validator: isValidNeuronId,
  description: 'Neuron identifier'
};

/**
 * Common schema for strength parameter
 */
export const strengthSchema: FieldSchema = {
  type: 'number',
  min: 0,
  max: 1,
  default: 0.5,
  description: 'Strength value (0-1)'
};

/**
 * Common schema for priority parameter
 */
export const prioritySchema: FieldSchema = {
  type: 'number',
  min: 1,
  max: 10,
  default: 5,
  description: 'Priority level (1-10)'
};

/**
 * Common schema for depth parameter
 */
export const depthSchema: FieldSchema = {
  type: 'number',
  min: 1,
  max: 100,
  default: 5,
  description: 'Search depth'
};

/**
 * Common schema for limit parameter
 */
export const limitSchema: FieldSchema = {
  type: 'number',
  min: 1,
  max: 1000,
  default: 10,
  description: 'Result limit'
};
