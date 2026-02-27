/**
 * Learn Commands - Four-stage learning system
 */

import type { CommandConfig, CommandResult, ProbabilisticContext } from '../types.js';
import { validateArgs, validationError, isValidNeuronId, type CommandSchema } from '../utils/validators.js';

export async function cmdLearn(
  args: string[],
  config: CommandConfig,
  ctx: ProbabilisticContext
): Promise<CommandResult> {
  const subCommand = args[0];
  const params = args.slice(1);

  if (!ctx.learningSystem) {
    return { success: false, error: 'Learning system not initialized' };
  }

  switch (subCommand) {
    case 'extract': {
      const extractSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
        limit: { type: 'number', min: 1, max: 100, default: 10 },
      };
      const validation = validateArgs(params, extractSchema, ['neuronId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const neuronId = validation.data!.neuronId as string;
      const limit = validation.data!.limit as number;
      const neuron = await ctx.neuronStore.getNeuron(neuronId);

      if (!neuron) {
        return { success: false, error: `Neuron not found: ${neuronId}` };
      }

      // Build content from neuron metadata and connections
      const parts: string[] = [];
      if (neuron.metadata.tags.length > 0) {
        parts.push(`Tags: ${neuron.metadata.tags.join(', ')}`);
      }
      if (neuron.metadata.sourceType) {
        parts.push(`Source: ${neuron.metadata.sourceType}`);
      }
      parts.push(`Chunks: ${neuron.chunkHashes.length}`);
      parts.push(`Connections: ${neuron.outgoingSynapses.length} out, ${neuron.incomingSynapses.length} in`);

      // Fetch connected neuron tags for richer context
      const connectedTags: string[] = [];
      for (const synId of neuron.outgoingSynapses.slice(0, 5)) {
        const syn = await ctx.neuronStore.getSynapse(synId);
        if (syn) {
          const target = await ctx.neuronStore.getNeuron(syn.targetId);
          if (target?.metadata.tags.length) {
            connectedTags.push(...target.metadata.tags);
          }
        }
      }
      if (connectedTags.length > 0) {
        parts.push(`Related: ${[...new Set(connectedTags)].join(', ')}`);
      }

      const content = parts.join('\n');
      const extracts = await ctx.learningSystem.extractMeaningful(neuronId, content);

      let output = `Extracted Meaningful Content from ${neuronId}:\n`;
      output += '='.repeat(60) + '\n\n';

      if (extracts.length === 0) {
        output += '  No meaningful content extracted.\n';
      } else {
        for (const ext of extracts.slice(0, limit)) {
          output += `  [${ext.category}] ${ext.content.substring(0, 60)}...\n`;
          output += `    Importance: ${ext.importance.toFixed(2)}\n\n`;
        }
      }

      return { success: true, data: output };
    }

    case 'stats': {
      const stats = ctx.learningSystem.getStats();

      let output = 'Learning System Statistics:\n';
      output += '='.repeat(60) + '\n';
      output += `\n  Total Extracts: ${stats.extracts}\n`;
      output += `  Patterns Learned: ${stats.patterns}\n`;
      output += `  Processes Recorded: ${stats.processes}\n`;
      output += `  Outcomes Tracked: ${stats.outcomes}\n`;
      output += `  Avg Pattern Confidence: ${stats.averagePatternConfidence.toFixed(2)}\n`;
      output += `  Avg Process Success: ${(stats.averageProcessSuccess * 100).toFixed(1)}%\n`;

      return { success: true, data: output };
    }

    case 'session': {
      const sessionSchema: CommandSchema = {
        action: { type: 'string', required: true, enum: ['start', 'end'] },
      };
      const validation = validateArgs(params, sessionSchema, ['action']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const action = validation.data!.action as string;
      if (action === 'start') {
        const session = ctx.learningSystem.startSession();
        return { success: true, data: `Started learning session: ${session.id}` };
      } else {
        const session = ctx.learningSystem.endSession();
        if (!session) {
          return { success: false, error: 'No active learning session.' };
        }
        let output = `Ended learning session: ${session.id}\n`;
        output += `  Extracts: ${session.metrics.totalExtracts}\n`;
        output += `  Patterns: ${session.metrics.patternsDiscovered}\n`;
        output += `  Processes: ${session.metrics.processesLearned}\n`;
        return { success: true, data: output };
      }
    }

    default:
      return {
        success: false,
        error: `Unknown learn subcommand: ${subCommand}\n` +
          'Available: extract, stats, session',
      };
  }
}
