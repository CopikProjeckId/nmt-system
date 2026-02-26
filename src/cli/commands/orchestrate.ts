/**
 * Orchestrate Commands - Unified orchestration
 */

import type { CommandConfig, CommandResult, ProbabilisticContext } from '../types.js';
import {
  validateArgs,
  validationError,
  isValidNeuronId,
  isValidProbability,
  isNonEmptyString,
  type CommandSchema,
} from '../utils/validators.js';

export async function cmdOrchestrate(
  args: string[],
  config: CommandConfig,
  ctx: ProbabilisticContext
): Promise<CommandResult> {
  const subCommand = args[0];
  const params = args.slice(1);

  const { ProbabilisticOrchestrator } = await import('../../core/probabilistic-orchestrator.js');
  const orchestrator = new ProbabilisticOrchestrator({
    neuronStore: ctx.neuronStore,
    inferenceEngine: ctx.inferenceEngine as any,
    attractorModel: ctx.attractorModel as any,
    learningSystem: ctx.learningSystem as any,
    neuronManager: ctx.neuronManager as any,
    embeddingManager: ctx.embeddingManager as any,
  });

  switch (subCommand) {
    case 'infer': {
      const inferSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
        depth: { type: 'number', min: 1, max: 10, default: 3 },
        noAttractors: { type: 'boolean', default: false },
        noProbabilistic: { type: 'boolean', default: false },
      };
      const validation = validateArgs(params, inferSchema, ['neuronId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const neuronId = validation.data!.neuronId as string;
      const depth = validation.data!.depth as number;
      const noAttractors = validation.data!.noAttractors as boolean;
      const noProbabilistic = validation.data!.noProbabilistic as boolean;
      const includeAttractors = !noAttractors;
      const includeProbabilistic = !noProbabilistic;

      let result;
      try {
        result = await orchestrator.unifiedInfer(neuronId, {
          includeAttractors,
          includeProbabilistic,
          maxDepth: depth,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Unified inference failed: ${msg}` };
      }

      let output = `Unified Inference for ${neuronId}:\n`;
      output += '='.repeat(60) + '\n';

      output += '\nForward Paths (Cause → Effect):\n';
      if (result.forwardPaths.length === 0) {
        output += '  (none)\n';
      } else {
        for (const p of result.forwardPaths.slice(0, 5)) {
          output += `  → ${p.neuronId} (conf: ${p.confidence.toFixed(3)})\n`;
        }
      }

      output += '\nBackward Paths (Effect ← Cause):\n';
      if (result.backwardPaths.length === 0) {
        output += '  (none)\n';
      } else {
        for (const p of result.backwardPaths.slice(0, 5)) {
          output += `  ← ${p.neuronId} (conf: ${p.confidence.toFixed(3)})\n`;
        }
      }

      if (includeAttractors && result.attractorInfluences.size > 0) {
        output += '\nAttractor Influences:\n';
        for (const [attrId, influence] of result.attractorInfluences) {
          output += `  ${attrId}: ${influence.toFixed(4)}\n`;
        }
        if (result.dominantAttractor) {
          output += `  Dominant: ${result.dominantAttractor}\n`;
        }
        if (result.pathToGoal && result.pathToGoal.length > 0) {
          output += `  Path to Goal: ${result.pathToGoal.join(' → ')}\n`;
        }
      }

      if (includeProbabilistic && result.stateDistribution) {
        output += '\nState Distribution:\n';
        output += `  Entropy: ${result.stateDistribution.entropy.toFixed(4)}\n`;
        output += `  Most Probable State: ${result.stateDistribution.mostProbableState}\n`;
      }

      output += '\nRecommendations:\n';
      if (result.recommendations.length === 0) {
        output += '  (none)\n';
      } else {
        for (let i = 0; i < result.recommendations.length; i++) {
          const rec = result.recommendations[i];
          output += `  ${i + 1}. ${rec.neuronId}\n`;
          output += `     Reason: ${rec.reason}\n`;
          output += `     Score: ${rec.score.toFixed(3)}\n`;
        }
      }

      return { success: true, data: output };
    }

    case 'goal': {
      const goalSchema: CommandSchema = {
        neuronId: { type: 'uuid', required: true, validator: isValidNeuronId },
        attractorId: { type: 'uuid', required: true, validator: isValidNeuronId },
      };
      const validation = validateArgs(params, goalSchema, ['neuronId', 'attractorId']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const neuronId = validation.data!.neuronId as string;
      const attractorId = validation.data!.attractorId as string;
      const result = await orchestrator.createGoalDrivenNeuron(neuronId, attractorId);

      if (!result) {
        return { success: false, error: 'Failed to create goal-driven neuron (check if modules are initialized)' };
      }

      let output = `Goal-Driven Neuron Created:\n`;
      output += '='.repeat(60) + '\n';
      output += `\n  Neuron ID: ${result.neuronId}\n`;
      output += `  Initial State: ${result.initialState}\n`;
      output += `  Path Probability: ${(result.pathProbability * 100).toFixed(2)}%\n`;

      return { success: true, data: output };
    }

    case 'expand': {
      const expandSchema: CommandSchema = {
        concept: { type: 'string', required: true, minLength: 1, maxLength: 100 },
        category: { type: 'string', default: 'custom', maxLength: 50 },
      };
      const validation = validateArgs(params, expandSchema, ['concept']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const concept = validation.data!.concept as string;
      const category = validation.data!.category as string;
      const result = await orchestrator.expandForConcept(concept, category);

      let output = `Dimension Expansion:\n`;
      output += '='.repeat(60) + '\n';
      output += `\n  Concept: ${concept}\n`;
      output += `  Dimension Name: ${result.dimensionName}\n`;
      output += `  Total Dimensions: ${result.totalDimensions}\n`;

      return { success: true, data: output };
    }

    case 'stats': {
      const stats = orchestrator.getStats();

      let output = 'Orchestrator Statistics (All Modules):\n';
      output += '='.repeat(60) + '\n';

      output += '\nInference Engine:\n';
      output += `  Available: ${stats.inference.available}\n`;

      output += '\nAttractors:\n';
      output += `  Total: ${stats.attractors.count}\n`;
      output += `  Active: ${stats.attractors.active}\n`;

      output += '\nLearning System:\n';
      output += `  Patterns: ${stats.learning.patterns}\n`;
      output += `  Processes: ${stats.learning.processes}\n`;

      output += '\nProbabilistic Neurons:\n';
      output += `  Count: ${stats.neurons.count}\n`;
      output += `  Avg Entropy: ${stats.neurons.avgEntropy.toFixed(4)}\n`;

      output += '\nDimensions:\n';
      output += `  Total: ${stats.dimensions.total}\n`;
      output += `  Expanded: ${stats.dimensions.expanded}\n`;

      return { success: true, data: output };
    }

    case 'learn': {
      const learnSchema: CommandSchema = {
        input: { type: 'string', required: true, minLength: 1 },
        output: { type: 'string', required: true, minLength: 1 },
        success: { type: 'boolean', default: false },
        feedback: { type: 'number', min: 0, max: 1 },
        inputNeuron: { type: 'uuid' },
        outputNeuron: { type: 'uuid' },
      };
      const validation = validateArgs(params, learnSchema, []);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const input = validation.data!.input as string;
      const outputText = validation.data!.output as string;
      const success = (validation.data!.success as boolean) ?? false;
      const inputNeuronId = validation.data!.inputNeuron as string | undefined;
      const outputNeuronId = validation.data!.outputNeuron as string | undefined;
      const feedback = (validation.data!.feedback as number) ?? (success ? 0.8 : 0.2);

      try {
        const result = await orchestrator.learnFromInteraction({
          input,
          output: outputText,
          success,
          feedback,
          inputNeuronId: inputNeuronId || undefined,
          outputNeuronId: outputNeuronId || undefined,
        });

        let output = `Learning Result:\n`;
        output += '='.repeat(60) + '\n';
        output += `\n  Input: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"\n`;
        output += `  Output: "${outputText.substring(0, 50)}${outputText.length > 50 ? '...' : ''}"\n`;
        output += `  Success: ${success ? 'Yes' : 'No'}\n`;
        output += `  Feedback: ${feedback.toFixed(2)}\n`;
        output += `\n  Results:\n`;
        output += `    Extracts Created: ${result.extractsCreated}\n`;
        output += `    Patterns Learned: ${result.patternsLearned}\n`;
        output += `    Process Learned: ${result.processLearned ? 'Yes' : 'No'}\n`;
        output += `    Outcome Recorded: ${result.outcomeRecorded ? 'Yes' : 'No'}\n`;
        output += `    Attractors Updated: ${result.attractorsUpdated}\n`;
        output += `    Neurons Updated: ${result.neuronsUpdated}\n`;

        if (result.inputNeuronId) {
          output += `\n  Input Neuron: ${result.inputNeuronId}\n`;
        }
        if (result.outputNeuronId) {
          output += `  Output Neuron: ${result.outputNeuronId}\n`;
        }

        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Learning failed: ${msg}` };
      }
    }

    case 'feedback': {
      const feedbackSchema: CommandSchema = {
        inputNeuron: { type: 'uuid', required: true, validator: isValidNeuronId },
        outputNeuron: { type: 'uuid', required: true, validator: isValidNeuronId },
        quality: { type: 'number', min: 0, max: 1, default: 0.5 },
        text: { type: 'string', default: '' },
      };
      const validation = validateArgs(params, feedbackSchema, []);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const inputNeuronId = validation.data!.inputNeuron as string;
      const outputNeuronId = validation.data!.outputNeuron as string;
      const quality = validation.data!.quality as number;
      const text = validation.data!.text as string | undefined;

      try {
        const result = await orchestrator.provideFeedback(
          inputNeuronId,
          outputNeuronId,
          quality,
          text || undefined
        );

        let output = `Feedback Recorded:\n`;
        output += '='.repeat(60) + '\n';
        output += `\n  Input Neuron: ${inputNeuronId}\n`;
        output += `  Output Neuron: ${outputNeuronId}\n`;
        output += `  Quality: ${quality.toFixed(2)}\n`;
        output += `  Updated: ${result.updated ? 'Yes' : 'No'}\n`;

        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Feedback failed: ${msg}` };
      }
    }

    case 'reinforce': {
      const reinforceSchema: CommandSchema = {
        from: { type: 'uuid', required: true, validator: isValidNeuronId },
        to: { type: 'uuid', required: true, validator: isValidNeuronId },
        strength: { type: 'number', min: 0, max: 1, default: 0.1 },
      };
      const validation = validateArgs(params, reinforceSchema, []);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const fromId = validation.data!.from as string;
      const toId = validation.data!.to as string;
      const strength = validation.data!.strength as number;

      try {
        const result = await orchestrator.reinforceSuccessfulPath(fromId, toId, strength);

        let output = `Path Reinforced:\n`;
        output += '='.repeat(60) + '\n';
        output += `\n  From: ${fromId}\n`;
        output += `  To: ${toId}\n`;
        output += `  Strength: ${strength.toFixed(2)}\n`;
        output += `  Reinforced: ${result.reinforced ? 'Yes' : 'No'}\n`;

        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Reinforcement failed: ${msg}` };
      }
    }

    default:
      return {
        success: false,
        error: `Unknown orchestrate subcommand: ${subCommand}\n` +
          'Available: infer, goal, expand, stats, learn, feedback, reinforce',
      };
  }
}
