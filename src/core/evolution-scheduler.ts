/**
 * Evolution Scheduler - Automatic temporal evolution
 *
 * Based on Probabilistic Ontology Framework:
 * - Probabilistic neurons evolve over time (decoherence)
 * - Attractors decay when unused
 * - States become more classical over time
 *
 * @module core/evolution-scheduler
 */

import type { ProbabilisticNeuronManager } from './probabilistic-neuron.js';
import type { AttractorModel } from './attractor-model.js';
import type { FourStageLearningSystem } from '../services/four-stage-learning.js';

/**
 * Evolution statistics
 */
export interface EvolutionStats {
  neuronsEvolved: number;
  attractorsDecayed: number;
  patternsProcessed: number;
  timestamp: string;
  duration: number;
}

/**
 * Scheduler status
 */
export interface SchedulerStatus {
  running: boolean;
  lastEvolution?: EvolutionStats;
  nextEvolutionAt?: string;
  totalEvolutions: number;
  startedAt?: string;
}

/**
 * Evolution Scheduler Options
 */
export interface EvolutionSchedulerOptions {
  neuronManager?: ProbabilisticNeuronManager;
  attractorModel?: AttractorModel;
  learningSystem?: FourStageLearningSystem;

  // Evolution intervals (ms)
  neuronEvolveInterval: number;      // Default: 60000 (1 minute)
  attractorDecayInterval: number;    // Default: 3600000 (1 hour)

  // Callbacks
  onEvolve?: (stats: EvolutionStats) => void;
  onError?: (error: Error) => void;
}

/**
 * Default intervals
 */
const DEFAULT_INTERVALS = {
  neuronEvolve: 60000,      // 1 minute
  attractorDecay: 3600000,  // 1 hour
};

/**
 * Evolution Scheduler
 *
 * Manages automatic temporal evolution of probabilistic modules:
 * - Periodic neuron state evolution (decoherence)
 * - Attractor strength decay
 * - Pattern aging
 */
export class EvolutionScheduler {
  private neuronManager?: ProbabilisticNeuronManager;
  private attractorModel?: AttractorModel;
  private learningSystem?: FourStageLearningSystem;

  private neuronEvolveInterval: number;
  private attractorDecayInterval: number;

  private onEvolve?: (stats: EvolutionStats) => void;
  private onError?: (error: Error) => void;

  // Timer references
  private neuronTimer?: ReturnType<typeof setInterval>;
  private attractorTimer?: ReturnType<typeof setInterval>;

  // Status tracking
  private running: boolean = false;
  private totalEvolutions: number = 0;
  private lastEvolution?: EvolutionStats;
  private startedAt?: string;
  private lastNeuronEvolve?: number;
  private lastAttractorDecay?: number;

  constructor(options: EvolutionSchedulerOptions) {
    this.neuronManager = options.neuronManager;
    this.attractorModel = options.attractorModel;
    this.learningSystem = options.learningSystem;

    this.neuronEvolveInterval = options.neuronEvolveInterval ?? DEFAULT_INTERVALS.neuronEvolve;
    this.attractorDecayInterval = options.attractorDecayInterval ?? DEFAULT_INTERVALS.attractorDecay;

    this.onEvolve = options.onEvolve;
    this.onError = options.onError;
  }

  /**
   * Start the evolution scheduler
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.lastNeuronEvolve = Date.now();
    this.lastAttractorDecay = Date.now();

    // Start neuron evolution timer
    if (this.neuronManager) {
      this.neuronTimer = setInterval(
        () => this.evolveNeurons(),
        this.neuronEvolveInterval
      );
    }

    // Start attractor decay timer
    if (this.attractorModel) {
      this.attractorTimer = setInterval(
        () => this.decayAttractors(),
        this.attractorDecayInterval
      );
    }
  }

  /**
   * Stop the evolution scheduler
   */
  stop(): void {
    if (!this.running) return;

    if (this.neuronTimer) {
      clearInterval(this.neuronTimer);
      this.neuronTimer = undefined;
    }

    if (this.attractorTimer) {
      clearInterval(this.attractorTimer);
      this.attractorTimer = undefined;
    }

    this.running = false;
  }

  /**
   * Trigger manual evolution
   */
  async evolveNow(): Promise<EvolutionStats> {
    const startTime = Date.now();
    const stats: EvolutionStats = {
      neuronsEvolved: 0,
      attractorsDecayed: 0,
      patternsProcessed: 0,
      timestamp: new Date().toISOString(),
      duration: 0,
    };

    try {
      // Evolve neurons
      if (this.neuronManager) {
        const deltaTime = this.lastNeuronEvolve
          ? Date.now() - this.lastNeuronEvolve
          : this.neuronEvolveInterval;

        const neuronIds = this.neuronManager.getAllNeuronIds();
        for (const id of neuronIds) {
          this.neuronManager.evolve(id, deltaTime);
          stats.neuronsEvolved++;
        }
        this.lastNeuronEvolve = Date.now();
      }

      // Decay attractors
      if (this.attractorModel) {
        const beforeCount = this.attractorModel.getActiveAttractors().length;
        this.attractorModel.decayAttractors();
        const afterCount = this.attractorModel.getActiveAttractors().length;
        stats.attractorsDecayed = beforeCount - afterCount;
        this.lastAttractorDecay = Date.now();
      }

      stats.duration = Date.now() - startTime;
      this.lastEvolution = stats;
      this.totalEvolutions++;

      // Notify callback
      if (this.onEvolve) {
        this.onEvolve(stats);
      }
    } catch (error) {
      if (this.onError) {
        this.onError(error as Error);
      }
    }

    return stats;
  }

  /**
   * Get scheduler status
   */
  getStatus(): SchedulerStatus {
    const status: SchedulerStatus = {
      running: this.running,
      totalEvolutions: this.totalEvolutions,
    };

    if (this.lastEvolution) {
      status.lastEvolution = this.lastEvolution;
    }

    if (this.startedAt) {
      status.startedAt = this.startedAt;
    }

    if (this.running && this.lastNeuronEvolve) {
      const nextEvolution = this.lastNeuronEvolve + this.neuronEvolveInterval;
      status.nextEvolutionAt = new Date(nextEvolution).toISOString();
    }

    return status;
  }

  /**
   * Update intervals (requires restart)
   */
  setIntervals(intervals: {
    neuronEvolve?: number;
    attractorDecay?: number;
  }): void {
    if (intervals.neuronEvolve !== undefined) {
      this.neuronEvolveInterval = intervals.neuronEvolve;
    }
    if (intervals.attractorDecay !== undefined) {
      this.attractorDecayInterval = intervals.attractorDecay;
    }

    // Restart if running
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  // ==================== Private Evolution Methods ====================

  private evolveNeurons(): void {
    if (!this.neuronManager) return;

    try {
      const deltaTime = this.lastNeuronEvolve
        ? Date.now() - this.lastNeuronEvolve
        : this.neuronEvolveInterval;

      const neuronIds = this.neuronManager.getAllNeuronIds();
      let evolved = 0;

      for (const id of neuronIds) {
        this.neuronManager.evolve(id, deltaTime);
        evolved++;
      }

      this.lastNeuronEvolve = Date.now();

      // Update stats
      if (this.lastEvolution) {
        this.lastEvolution.neuronsEvolved = evolved;
        this.lastEvolution.timestamp = new Date().toISOString();
      }
    } catch (error) {
      if (this.onError) {
        this.onError(error as Error);
      }
    }
  }

  private decayAttractors(): void {
    if (!this.attractorModel) return;

    try {
      const beforeCount = this.attractorModel.getActiveAttractors().length;
      this.attractorModel.decayAttractors();
      const afterCount = this.attractorModel.getActiveAttractors().length;

      this.lastAttractorDecay = Date.now();

      const decayed = beforeCount - afterCount;

      // Create evolution stats for attractor decay
      const stats: EvolutionStats = {
        neuronsEvolved: 0,
        attractorsDecayed: decayed,
        patternsProcessed: 0,
        timestamp: new Date().toISOString(),
        duration: 0,
      };

      this.lastEvolution = stats;
      this.totalEvolutions++;

      if (this.onEvolve && decayed > 0) {
        this.onEvolve(stats);
      }
    } catch (error) {
      if (this.onError) {
        this.onError(error as Error);
      }
    }
  }
}

/**
 * Create an EvolutionScheduler instance
 */
export function createEvolutionScheduler(
  options: EvolutionSchedulerOptions
): EvolutionScheduler {
  return new EvolutionScheduler(options);
}
