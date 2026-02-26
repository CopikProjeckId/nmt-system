/**
 * Infer Commands - Bidirectional inference
 */

import type { CommandConfig, CommandResult, ProbabilisticContext } from '../types.js';
import { formatInferenceResults, formatCausalChain, formatBidirectionalResults } from '../utils/formatters.js';
import { validateArgs, validationError, isValidNeuronId, type CommandSchema } from '../utils/validators.js';

export async function cmdInfer(
  args: string[],
  config: CommandConfig,
  ctx: ProbabilisticContext
): Promise<CommandResult> {
  const subCommand = args[0];
  const params = args.slice(1);

  if (!ctx.inferenceEngine) {
    return { success: false, error: 'Inference engine not initialized' };
  }

  switch (subCommand) {
    case 'forward': {
      const forwardSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
        depth: { type: 'number', min: 1, max: 10, default: 3 },
      };
      const validation = validateArgs(params, forwardSchema, ['neuronId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const neuronId = validation.data!.neuronId as string;
      const depth = validation.data!.depth as number;

      try {
        const neuron = await ctx.neuronStore.getNeuron(neuronId);
        if (!neuron) {
          return { success: false, error: `Neuron not found: ${neuronId}` };
        }

        const results = await ctx.inferenceEngine.forwardInfer(neuron);

        return {
          success: true,
          data: formatInferenceResults('Forward Inference', results),
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Forward inference failed: ${msg}` };
      }
    }

    case 'backward': {
      const backwardSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
        depth: { type: 'number', min: 1, max: 10, default: 3 },
      };
      const validation = validateArgs(params, backwardSchema, ['neuronId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const neuronId = validation.data!.neuronId as string;
      const depth = validation.data!.depth as number;

      try {
        const neuron = await ctx.neuronStore.getNeuron(neuronId);
        if (!neuron) {
          return { success: false, error: `Neuron not found: ${neuronId}` };
        }

        const results = await ctx.inferenceEngine.backwardInfer(neuron);

        return {
          success: true,
          data: formatInferenceResults('Backward Inference (Abduction)', results),
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Backward inference failed: ${msg}` };
      }
    }

    case 'causal': {
      const causalSchema: CommandSchema = {
        fromId: { type: 'uuid', required: true, validator: isValidNeuronId },
        toId: { type: 'uuid', required: true, validator: isValidNeuronId },
      };
      const validation = validateArgs(params, causalSchema, ['fromId', 'toId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const fromId = validation.data!.fromId as string;
      const toId = validation.data!.toId as string;

      try {
        const fromNeuron = await ctx.neuronStore.getNeuron(fromId);
        const toNeuron = await ctx.neuronStore.getNeuron(toId);
        if (!fromNeuron) {
          return { success: false, error: `Source neuron not found: ${fromId}` };
        }
        if (!toNeuron) {
          return { success: false, error: `Target neuron not found: ${toId}` };
        }

        const chain = await ctx.inferenceEngine.findCausalChain(fromNeuron, toNeuron);

        if (!chain) {
          return { success: true, data: 'No causal chain found between neurons.' };
        }

        return {
          success: true,
          data: formatCausalChain(chain),
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Causal chain search failed: ${msg}` };
      }
    }

    case 'bidirectional': {
      const biSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
        depth: { type: 'number', min: 1, max: 10, default: 3 },
      };
      const validation = validateArgs(params, biSchema, ['neuronId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const neuronId = validation.data!.neuronId as string;
      const depth = validation.data!.depth as number;

      try {
        const neuron = await ctx.neuronStore.getNeuron(neuronId);
        if (!neuron) {
          return { success: false, error: `Neuron not found: ${neuronId}` };
        }

        const results = await ctx.inferenceEngine.infer(neuron, {
          direction: 'both',
          maxDepth: depth,
        });

        return {
          success: true,
          data: formatBidirectionalResults(results),
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Bidirectional inference failed: ${msg}` };
      }
    }

    default:
      return {
        success: false,
        error: `Unknown infer subcommand: ${subCommand}\n` +
          'Available: forward, backward, causal, bidirectional',
      };
  }
}
