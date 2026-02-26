/**
 * Attractor Commands - Future goal management
 */

import type { CommandConfig, CommandResult, ProbabilisticContext } from '../types.js';
import { extractFlag, extractStringFlag } from '../utils/helpers.js';
import {
  validateArgs,
  validationError,
  type CommandSchema,
  strengthSchema,
  prioritySchema,
  depthSchema,
  isValidNeuronId,
} from '../utils/validators.js';

export async function cmdAttractor(
  args: string[],
  config: CommandConfig,
  ctx: ProbabilisticContext
): Promise<CommandResult> {
  const subCommand = args[0];
  const params = args.slice(1);

  if (!ctx.attractorModel) {
    return { success: false, error: 'Attractor model not initialized' };
  }

  switch (subCommand) {
    case 'create': {
      // Validate input with schema
      const createSchema: CommandSchema = {
        name: { type: 'string', required: true, minLength: 1, maxLength: 100, description: 'Attractor name' },
        strength: strengthSchema,
        description: { type: 'string', default: '', description: 'Attractor description' },
        priority: prioritySchema,
      };

      const validation = validateArgs(params, createSchema, ['name']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const { name, strength, description, priority } = validation.data as {
        name: string;
        strength: number;
        description: string;
        priority: number;
      };

      try {
        const id = `attr_${Date.now().toString(36)}`;

        const { getEmbeddingProvider } = await import('../../services/embedding-provider.js');
        const provider = await getEmbeddingProvider();
        const textForEmbedding = `${name} ${description}`.trim();
        const embedding = await provider.embed(textForEmbedding);

        const attractor = ctx.attractorModel.createAttractor(
          id,
          name,
          description,
          embedding,
          { strength, priority }
        );

        return {
          success: true,
          data: `Created attractor: ${attractor.id}\n` +
            `  Name: ${attractor.name}\n` +
            `  Strength: ${attractor.strength}\n` +
            `  Priority: ${attractor.priority}\n` +
            `  Created: ${new Date(attractor.createdAt).toLocaleString()}`,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to create attractor: ${msg}` };
      }
    }

    case 'list': {
      const attractors = ctx.attractorModel.getActiveAttractors();

      if (attractors.length === 0) {
        return { success: true, data: 'No attractors defined.' };
      }

      let output = `Attractors (${attractors.length}):\n`;
      output += '='.repeat(60) + '\n';

      for (const attr of attractors) {
        output += `\n  ${attr.id}\n`;
        output += `    Name: ${attr.name}\n`;
        output += `    Strength: ${attr.strength.toFixed(2)}\n`;
        output += `    Priority: ${attr.priority}\n`;
        output += `    Probability: ${(attr.probability * 100).toFixed(1)}%\n`;
        if (attr.deadline) {
          output += `    Deadline: ${new Date(attr.deadline).toLocaleString()}\n`;
        }
      }

      return { success: true, data: output };
    }

    case 'influence': {
      // Validate neuron ID
      const influenceSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
      };

      const validation = validateArgs(params, influenceSchema, ['neuronId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const { neuronId } = validation.data as { neuronId: string };
      const neuron = await ctx.neuronStore.getNeuron(neuronId);

      if (!neuron) {
        return { success: false, error: `Neuron not found: ${neuronId}` };
      }

      const influences = ctx.attractorModel.calculateInfluence(neuron.embedding);

      let output = `Attractor Influence on ${neuronId}:\n`;
      output += '='.repeat(60) + '\n';

      if (influences.size === 0) {
        output += '\n  No active attractors influencing this neuron.';
      } else {
        let total = 0;
        for (const [attractorId, influence] of influences) {
          output += `\n  ${attractorId}:\n`;
          output += `    Influence: ${influence.toFixed(4)}\n`;
          total += influence;
        }
        output += `\n  Total Influence: ${total.toFixed(4)}`;
      }

      return { success: true, data: output };
    }

    case 'path': {
      // Validate path arguments
      const pathSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
        attractorId: { type: 'uuid', required: true, validator: isValidNeuronId },
        depth: { ...depthSchema, max: 20, default: 10 },
      };

      const validation = validateArgs(params, pathSchema, ['neuronId', 'attractorId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const { neuronId, attractorId, depth: maxDepth } = validation.data as {
        neuronId: string;
        attractorId: string;
        depth: number;
      };

      const path = await ctx.attractorModel.findPathToAttractor(neuronId, attractorId, maxDepth);

      if (!path || path.path.length === 0) {
        return { success: true, data: 'No path found to attractor.' };
      }

      let output = `Path to Attractor ${attractorId}:\n`;
      output += '='.repeat(60) + '\n';
      output += `\nEstimated Steps: ${path.estimatedSteps}\n`;
      output += `Path Probability: ${(path.probability * 100).toFixed(2)}%\n\n`;

      output += 'Path:\n';
      for (let i = 0; i < path.path.length; i++) {
        const nodeId = path.path[i];
        const arrow = i < path.path.length - 1 ? ' ->' : '';
        output += `  ${i + 1}. ${nodeId}${arrow}\n`;
      }

      if (path.bottlenecks.length > 0) {
        output += `\nBottlenecks: ${path.bottlenecks.join(', ')}\n`;
      }

      return { success: true, data: output };
    }

    case 'update': {
      // Validate update arguments
      const updateSchema: CommandSchema = {
        attractorId: { type: 'uuid', required: true, validator: isValidNeuronId },
        strength: { type: 'number', min: 0, max: 1 },
        priority: { type: 'number', min: 1, max: 10 },
      };

      const validation = validateArgs(params, updateSchema, ['attractorId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const { attractorId, strength, priority } = validation.data as {
        attractorId: string;
        strength?: number;
        priority?: number;
      };

      const updates: { strength?: number; priority?: number } = {};
      if (strength !== undefined) updates.strength = strength;
      if (priority !== undefined) updates.priority = priority;

      const result = ctx.attractorModel.updateAttractor(attractorId, updates);
      if (!result) {
        return { success: false, error: `Attractor not found: ${attractorId}` };
      }
      return { success: true, data: `Updated attractor: ${attractorId}` };
    }

    case 'stats': {
      const stats = ctx.attractorModel.getStats();

      let output = 'Attractor Model Statistics:\n';
      output += '='.repeat(60) + '\n';
      output += `\n  Total Attractors: ${stats.totalAttractors}\n`;
      output += `  Active Attractors: ${stats.activeAttractors}\n`;
      output += `  Transitions: ${stats.transitions}\n`;

      return { success: true, data: output };
    }

    default:
      return {
        success: false,
        error: `Unknown attractor subcommand: ${subCommand}\n` +
          'Available: create, list, influence, path, update, stats',
      };
  }
}
