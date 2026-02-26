/**
 * Prob Commands - System management
 */

import type { CommandConfig, CommandResult, ProbabilisticContext } from '../types.js';
import { getMetrics, MetricNames } from '../../utils/metrics.js';

export async function cmdProb(
  args: string[],
  config: CommandConfig,
  ctx: ProbabilisticContext
): Promise<CommandResult> {
  const subCommand = args[0];

  const { ProbabilisticOrchestrator } = await import('../../core/probabilistic-orchestrator.js');
  const { ProbabilisticStore } = await import('../../storage/probabilistic-store.js');

  const store = new ProbabilisticStore({
    dataDir: config.dataDir,
  });

  const orchestrator = new ProbabilisticOrchestrator({
    neuronStore: ctx.neuronStore,
    inferenceEngine: ctx.inferenceEngine as any,
    attractorModel: ctx.attractorModel as any,
    learningSystem: ctx.learningSystem as any,
    neuronManager: ctx.neuronManager as any,
    embeddingManager: ctx.embeddingManager as any,
    probabilisticStore: store,
    config: {
      enableAutoSave: true,
      enableAutoEvolution: true,
    },
  });

  switch (subCommand) {
    case 'init': {
      try {
        await orchestrator.init();
        const status = orchestrator.getEvolutionStatus();

        let output = 'Probabilistic System Initialized:\n';
        output += '='.repeat(60) + '\n';
        output += '\n  Status: Ready\n';
        output += `  Auto-Save: Enabled\n`;
        output += `  Auto-Evolution: ${status?.running ? 'Running' : 'Ready'}\n`;

        const stats = orchestrator.getStats();
        output += `\n  Loaded State:\n`;
        output += `    Attractors: ${stats.attractors.count}\n`;
        output += `    Patterns: ${stats.learning.patterns}\n`;
        output += `    Neurons: ${stats.neurons.count}\n`;
        output += `    Dimensions: ${stats.dimensions.total}\n`;

        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to initialize: ${msg}` };
      }
    }

    case 'save': {
      try {
        await orchestrator.init();
        const result = await orchestrator.saveState();

        let output = 'State Saved:\n';
        output += '='.repeat(60) + '\n';
        output += `\n  Timestamp: ${result.timestamp}\n`;
        output += `  Modules Saved:\n`;
        output += `    Attractors: ${result.modules.attractors ? '✓' : '✗'}\n`;
        output += `    Learning: ${result.modules.learning ? '✓' : '✗'}\n`;
        output += `    Neurons: ${result.modules.neurons ? '✓' : '✗'}\n`;
        output += `    Dimensions: ${result.modules.dimensions ? '✓' : '✗'}\n`;

        await orchestrator.shutdown();
        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to save: ${msg}` };
      }
    }

    case 'load': {
      try {
        await orchestrator.init();

        const stats = orchestrator.getStats();

        let output = 'State Loaded:\n';
        output += '='.repeat(60) + '\n';
        output += `\n  Attractors: ${stats.attractors.count} (${stats.attractors.active} active)\n`;
        output += `  Patterns: ${stats.learning.patterns}\n`;
        output += `  Processes: ${stats.learning.processes}\n`;
        output += `  Probabilistic Neurons: ${stats.neurons.count}\n`;
        output += `  Dimensions: ${stats.dimensions.total}\n`;

        if (stats.persistence.lastSave) {
          output += `\n  Last Save: ${stats.persistence.lastSave}\n`;
        }

        await orchestrator.shutdown();
        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to load: ${msg}` };
      }
    }

    case 'evolve': {
      try {
        await orchestrator.init();
        const evolutionStats = await orchestrator.triggerEvolution();

        if (!evolutionStats) {
          return { success: false, error: 'Evolution scheduler not available.' };
        }

        let output = 'Manual Evolution Triggered:\n';
        output += '='.repeat(60) + '\n';
        output += `\n  Timestamp: ${evolutionStats.timestamp}\n`;
        output += `  Duration: ${evolutionStats.duration}ms\n`;
        output += `  Neurons Evolved: ${evolutionStats.neuronsEvolved}\n`;
        output += `  Attractors Decayed: ${evolutionStats.attractorsDecayed}\n`;
        output += `  Patterns Processed: ${evolutionStats.patternsProcessed}\n`;

        await orchestrator.shutdown();
        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Evolution failed: ${msg}` };
      }
    }

    case 'status': {
      try {
        await orchestrator.init();

        const stats = orchestrator.getStats();
        const evolveStatus = orchestrator.getEvolutionStatus();
        const configData = orchestrator.getConfig();

        let output = 'Probabilistic System Status:\n';
        output += '='.repeat(60) + '\n';

        output += '\n  Configuration:\n';
        output += `    Auto-Save Interval: ${configData.autoSaveInterval / 1000}s\n`;
        output += `    Auto-Evolution: ${configData.enableAutoEvolution ? 'Enabled' : 'Disabled'}\n`;
        output += `    Neuron Evolve Interval: ${configData.neuronEvolveInterval / 1000}s\n`;
        output += `    Attractor Decay Interval: ${configData.attractorDecayInterval / 1000}s\n`;

        output += '\n  Evolution Scheduler:\n';
        if (evolveStatus) {
          output += `    Running: ${evolveStatus.running ? 'Yes' : 'No'}\n`;
          output += `    Total Evolutions: ${evolveStatus.totalEvolutions}\n`;
          if (evolveStatus.startedAt) {
            output += `    Started At: ${evolveStatus.startedAt}\n`;
          }
          if (evolveStatus.lastEvolution) {
            output += `    Last Evolution: ${evolveStatus.lastEvolution.timestamp}\n`;
            output += `      Neurons: ${evolveStatus.lastEvolution.neuronsEvolved}\n`;
            output += `      Attractors: ${evolveStatus.lastEvolution.attractorsDecayed}\n`;
          }
        } else {
          output += `    Not initialized\n`;
        }

        output += '\n  Modules:\n';
        output += `    Inference: ${stats.inference.available ? 'Available' : 'Not loaded'}\n`;
        output += `    Attractors: ${stats.attractors.count} total, ${stats.attractors.active} active\n`;
        output += `    Learning: ${stats.learning.patterns} patterns, ${stats.learning.processes} processes\n`;
        output += `    Neurons: ${stats.neurons.count} probabilistic (avg entropy: ${stats.neurons.avgEntropy.toFixed(4)})\n`;
        output += `    Dimensions: ${stats.dimensions.total} (${stats.dimensions.expanded} expanded)\n`;

        output += '\n  Persistence:\n';
        output += `    Enabled: ${stats.persistence.enabled ? 'Yes' : 'No'}\n`;
        if (stats.persistence.lastSave) {
          output += `    Last Save: ${stats.persistence.lastSave}\n`;
        }

        await orchestrator.shutdown();
        return { success: true, data: output };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Status check failed: ${msg}` };
      }
    }

    case 'metrics': {
      const metrics = getMetrics();
      const snapshot = metrics.snapshot();
      const health = await metrics.checkHealth();

      let output = 'System Metrics:\n';
      output += '='.repeat(60) + '\n';

      output += `\n  Uptime: ${Math.floor(snapshot.uptime / 1000)}s\n`;
      output += `  Timestamp: ${snapshot.timestamp}\n`;

      output += '\n  Counters:\n';
      const counterEntries = Object.entries(snapshot.counters);
      if (counterEntries.length === 0) {
        output += '    (none)\n';
      } else {
        for (const [name, value] of counterEntries) {
          output += `    ${name}: ${value}\n`;
        }
      }

      output += '\n  Gauges:\n';
      const gaugeEntries = Object.entries(snapshot.gauges);
      if (gaugeEntries.length === 0) {
        output += '    (none)\n';
      } else {
        for (const [name, value] of gaugeEntries) {
          output += `    ${name}: ${value}\n`;
        }
      }

      output += '\n  Histograms:\n';
      const histogramEntries = Object.entries(snapshot.histograms);
      if (histogramEntries.length === 0) {
        output += '    (none)\n';
      } else {
        for (const [name, data] of histogramEntries) {
          output += `    ${name}:\n`;
          output += `      Count: ${data.count}\n`;
          output += `      Min: ${data.min.toFixed(2)}ms\n`;
          output += `      Max: ${data.max.toFixed(2)}ms\n`;
          output += `      Avg: ${(data.sum / data.count).toFixed(2)}ms\n`;
        }
      }

      output += '\n  Health Status:\n';
      output += `    Overall: ${health.status.toUpperCase()}\n`;
      if (health.checks.length === 0) {
        output += '    Checks: (none registered)\n';
      } else {
        for (const check of health.checks) {
          const icon = check.healthy ? '✓' : '✗';
          output += `    ${icon} ${check.name}: ${check.message || (check.healthy ? 'OK' : 'Failed')}`;
          if (check.latency) {
            output += ` (${check.latency.toFixed(1)}ms)`;
          }
          output += '\n';
        }
      }

      return { success: true, data: output };
    }

    case 'prometheus': {
      const metrics = getMetrics();
      const prometheusOutput = metrics.toPrometheus();

      return { success: true, data: prometheusOutput || '# No metrics collected yet\n' };
    }

    case 'health': {
      const metrics = getMetrics();
      const health = await metrics.checkHealth();

      let output = `Health Status: ${health.status.toUpperCase()}\n`;
      output += '='.repeat(60) + '\n';
      output += `\n  Timestamp: ${health.timestamp}\n`;

      if (health.checks.length === 0) {
        output += '  No health checks registered.\n';
      } else {
        output += '\n  Checks:\n';
        for (const check of health.checks) {
          const icon = check.healthy ? '✓' : '✗';
          output += `    ${icon} ${check.name}\n`;
          if (check.message) {
            output += `      Message: ${check.message}\n`;
          }
          if (check.latency) {
            output += `      Latency: ${check.latency.toFixed(1)}ms\n`;
          }
        }
      }

      return { success: true, data: output };
    }

    default:
      return {
        success: false,
        error: `Unknown prob subcommand: ${subCommand}\n` +
          'Available: init, save, load, evolve, status, metrics, prometheus, health',
      };
  }
}
