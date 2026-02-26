/**
 * Unit Tests - CLI Input Validators
 */

import { describe, it, expect } from 'vitest';
import {
  isValidUUID,
  isValidNeuronId,
  numberInRange,
  isValidProbability,
  isValidStrength,
  isValidPriority,
  isPositiveInt,
  isNonEmptyString,
  isValidDate,
  validateSchema,
  validateArgs,
  validationError,
} from '../../src/cli/utils/validators.js';

describe('Field Validators', () => {
  describe('isValidUUID', () => {
    it('should accept valid UUIDs', () => {
      const result = isValidUUID('123e4567-e89b-12d3-a456-426614174000', 'id');
      expect(result.valid).toBe(true);
    });

    it('should accept short IDs', () => {
      const result = isValidUUID('attr_abc123', 'id');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid IDs', () => {
      const result = isValidUUID('ab', 'id');
      expect(result.valid).toBe(false);
    });

    it('should reject non-strings', () => {
      const result = isValidUUID(123, 'id');
      expect(result.valid).toBe(false);
    });
  });

  describe('isValidNeuronId', () => {
    it('should accept valid neuron IDs', () => {
      const result = isValidNeuronId('neuron_12345', 'id');
      expect(result.valid).toBe(true);
    });

    it('should accept hyphens', () => {
      const result = isValidNeuronId('test-neuron-1', 'id');
      expect(result.valid).toBe(true);
    });

    it('should reject empty strings', () => {
      const result = isValidNeuronId('', 'id');
      expect(result.valid).toBe(false);
    });

    it('should reject special characters', () => {
      const result = isValidNeuronId('neuron@#$', 'id');
      expect(result.valid).toBe(false);
    });
  });

  describe('numberInRange', () => {
    it('should accept numbers in range', () => {
      const validator = numberInRange(0, 10);
      expect(validator(5, 'num').valid).toBe(true);
      expect(validator(0, 'num').valid).toBe(true);
      expect(validator(10, 'num').valid).toBe(true);
    });

    it('should reject numbers out of range', () => {
      const validator = numberInRange(0, 10);
      expect(validator(-1, 'num').valid).toBe(false);
      expect(validator(11, 'num').valid).toBe(false);
    });

    it('should parse string numbers', () => {
      const validator = numberInRange(0, 10);
      expect(validator('5', 'num').valid).toBe(true);
      expect(validator('5', 'num').value).toBe(5);
    });
  });

  describe('isValidProbability', () => {
    it('should accept values between 0 and 1', () => {
      expect(isValidProbability(0, 'prob').valid).toBe(true);
      expect(isValidProbability(0.5, 'prob').valid).toBe(true);
      expect(isValidProbability(1, 'prob').valid).toBe(true);
    });

    it('should reject values outside 0-1', () => {
      expect(isValidProbability(-0.1, 'prob').valid).toBe(false);
      expect(isValidProbability(1.1, 'prob').valid).toBe(false);
    });
  });

  describe('isPositiveInt', () => {
    it('should accept positive integers', () => {
      expect(isPositiveInt(1, 'num').valid).toBe(true);
      expect(isPositiveInt(100, 'num').valid).toBe(true);
    });

    it('should reject zero', () => {
      expect(isPositiveInt(0, 'num').valid).toBe(false);
    });

    it('should reject negative numbers', () => {
      expect(isPositiveInt(-1, 'num').valid).toBe(false);
    });

    it('should reject floats', () => {
      expect(isPositiveInt(1.5, 'num').valid).toBe(false);
    });
  });

  describe('isNonEmptyString', () => {
    it('should accept non-empty strings', () => {
      expect(isNonEmptyString('hello', 'str').valid).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(isNonEmptyString('', 'str').valid).toBe(false);
    });

    it('should reject whitespace-only strings', () => {
      expect(isNonEmptyString('   ', 'str').valid).toBe(false);
    });

    it('should trim values', () => {
      const result = isNonEmptyString('  hello  ', 'str');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello');
    });
  });

  describe('isValidDate', () => {
    it('should accept valid ISO8601 dates', () => {
      const result = isValidDate('2024-01-15T10:30:00Z', 'date');
      expect(result.valid).toBe(true);
    });

    it('should accept simple date strings', () => {
      const result = isValidDate('2024-01-15', 'date');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid dates', () => {
      const result = isValidDate('not-a-date', 'date');
      expect(result.valid).toBe(false);
    });
  });
});

describe('Schema Validation', () => {
  describe('validateSchema', () => {
    it('should validate required fields', () => {
      const schema = {
        name: { type: 'string' as const, required: true },
      };

      const validResult = validateSchema({ name: 'test' }, schema);
      expect(validResult.valid).toBe(true);

      const invalidResult = validateSchema({}, schema);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors[0].field).toBe('name');
    });

    it('should apply default values', () => {
      const schema = {
        count: { type: 'number' as const, default: 10 },
      };

      const result = validateSchema({}, schema);
      expect(result.valid).toBe(true);
      expect(result.data?.count).toBe(10);
    });

    it('should validate number ranges', () => {
      const schema = {
        priority: { type: 'number' as const, min: 1, max: 10 },
      };

      expect(validateSchema({ priority: 5 }, schema).valid).toBe(true);
      expect(validateSchema({ priority: 0 }, schema).valid).toBe(false);
      expect(validateSchema({ priority: 11 }, schema).valid).toBe(false);
    });

    it('should validate string lengths', () => {
      const schema = {
        name: { type: 'string' as const, minLength: 3, maxLength: 10 },
      };

      expect(validateSchema({ name: 'abc' }, schema).valid).toBe(true);
      expect(validateSchema({ name: 'ab' }, schema).valid).toBe(false);
      expect(validateSchema({ name: 'abcdefghijk' }, schema).valid).toBe(false);
    });

    it('should validate enums', () => {
      const schema = {
        color: { type: 'string' as const, enum: ['red', 'green', 'blue'] },
      };

      expect(validateSchema({ color: 'red' }, schema).valid).toBe(true);
      expect(validateSchema({ color: 'yellow' }, schema).valid).toBe(false);
    });

    it('should validate patterns', () => {
      const schema = {
        email: { type: 'string' as const, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      };

      expect(validateSchema({ email: 'test@example.com' }, schema).valid).toBe(true);
      expect(validateSchema({ email: 'invalid' }, schema).valid).toBe(false);
    });

    it('should validate boolean types', () => {
      const schema = {
        enabled: { type: 'boolean' as const },
      };

      expect(validateSchema({ enabled: true }, schema).valid).toBe(true);
      expect(validateSchema({ enabled: 'true' }, schema).valid).toBe(true);
      expect(validateSchema({ enabled: '1' }, schema).valid).toBe(true);
      expect(validateSchema({ enabled: 'false' }, schema).valid).toBe(true);
    });

    it('should use custom validators', () => {
      const schema = {
        neuronId: {
          type: 'uuid' as const,
          required: true,
          validator: isValidNeuronId,
        },
      };

      expect(validateSchema({ neuronId: 'valid-id-123' }, schema).valid).toBe(true);
      expect(validateSchema({ neuronId: 'a@b' }, schema).valid).toBe(false);
    });
  });

  describe('validateArgs', () => {
    it('should extract positional arguments', () => {
      const schema = {
        neuronId: { type: 'uuid' as const, required: true },
        targetId: { type: 'uuid' as const, required: true },
      };

      const result = validateArgs(['neuron-1', 'neuron-2'], schema, ['neuronId', 'targetId']);
      expect(result.valid).toBe(true);
      expect(result.data?.neuronId).toBe('neuron-1');
      expect(result.data?.targetId).toBe('neuron-2');
    });

    it('should extract flag arguments', () => {
      const schema = {
        depth: { type: 'number' as const, default: 5 },
        verbose: { type: 'boolean' as const },
      };

      const result = validateArgs(['--depth', '10', '--verbose'], schema, []);
      expect(result.valid).toBe(true);
      expect(result.data?.depth).toBe(10);
      expect(result.data?.verbose).toBe(true);
    });

    it('should handle mixed positional and flag arguments', () => {
      const schema = {
        id: { type: 'uuid' as const, required: true },
        limit: { type: 'number' as const, default: 10 },
      };

      const result = validateArgs(['my-id', '--limit', '20'], schema, ['id']);
      expect(result.valid).toBe(true);
      expect(result.data?.id).toBe('my-id');
      expect(result.data?.limit).toBe(20);
    });

    it('should convert kebab-case flags to camelCase', () => {
      const schema = {
        maxDepth: { type: 'number' as const, default: 5 },
      };

      const result = validateArgs(['--max-depth', '15'], schema, []);
      expect(result.valid).toBe(true);
      expect(result.data?.maxDepth).toBe(15);
    });
  });
});

describe('Error Formatting', () => {
  it('should format validation errors as CommandResult', () => {
    const result = validationError([
      { field: 'name', message: 'is required' },
      { field: 'priority', message: 'must be between 1 and 10' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('name');
    expect(result.error).toContain('priority');
  });
});
