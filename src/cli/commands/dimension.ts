/**
 * Dimension Commands - Dynamic dimension management
 */

import type { CommandConfig, CommandResult, ProbabilisticContext } from '../types.js';
import { validateArgs, validationError, isNonEmptyString, type CommandSchema } from '../utils/validators.js';

export async function cmdDimension(
  args: string[],
  config: CommandConfig,
  ctx: ProbabilisticContext
): Promise<CommandResult> {
  const subCommand = args[0];
  const params = args.slice(1);

  if (!ctx.embeddingManager) {
    return { success: false, error: 'Dynamic embedding manager not initialized' };
  }

  switch (subCommand) {
    case 'stats': {
      const stats = ctx.embeddingManager.getStats();

      let output = 'Dynamic Embedding Statistics:\n';
      output += '='.repeat(60) + '\n';
      output += `\n  Total Dimensions: ${stats.totalDimensions}\n`;
      output += `  Base Dimensions: ${stats.baseDimensions}\n`;
      output += `  Expanded Dimensions: ${stats.expandedDimensions}\n`;
      output += `  Categories: ${stats.categories}\n`;
      output += `  Total Embeddings: ${stats.embeddings}\n`;

      return { success: true, data: output };
    }

    case 'register': {
      const registerSchema: CommandSchema = {
        name: { type: 'string', required: true, minLength: 1, maxLength: 100, validator: isNonEmptyString },
        category: { type: 'string', default: 'custom', maxLength: 50 },
        description: { type: 'string', default: '', maxLength: 500 },
      };
      const validation = validateArgs(params, registerSchema, ['name']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const name = validation.data!.name as string;
      const category = validation.data!.category as string;
      const description = validation.data!.description as string;

      ctx.embeddingManager.registerDimension(name, {
        name,
        description,
        semanticCategory: category,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      });

      return {
        success: true,
        data: `Registered dimension: ${name}\n  Category: ${category}`,
      };
    }

    case 'category': {
      const categorySchema: CommandSchema = {
        category: { type: 'string', required: true, minLength: 1, maxLength: 50 },
        limit: { type: 'number', min: 1, max: 100, default: 20 },
      };
      const validation = validateArgs(params, categorySchema, ['category']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const category = validation.data!.category as string;
      const limit = validation.data!.limit as number;
      const dimensions = ctx.embeddingManager.getDimensionsByCategory(category);

      if (dimensions.length === 0) {
        return { success: true, data: `No dimensions in category: ${category}` };
      }

      let output = `Dimensions in category "${category}" (${dimensions.length}):\n`;
      output += '='.repeat(60) + '\n';

      for (const dim of dimensions.slice(0, limit)) {
        output += `  - ${dim}\n`;
      }
      if (dimensions.length > limit) {
        output += `  ... and ${dimensions.length - limit} more\n`;
      }

      return { success: true, data: output };
    }

    case 'count': {
      const count = ctx.embeddingManager.getCurrentDimensionCount();
      return { success: true, data: `Current dimension count: ${count}` };
    }

    default:
      return {
        success: false,
        error: `Unknown dimension subcommand: ${subCommand}\n` +
          'Available: stats, register, category, count',
      };
  }
}
