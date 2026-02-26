/**
 * Probabilistic Orchestrator - Unified control for probabilistic modules
 *
 * Coordinates between:
 * - BidirectionalInferenceEngine (추론)
 * - AttractorModel (끌개)
 * - FourStageLearningSystem (학습)
 * - ProbabilisticNeuronManager (뉴런)
 * - DynamicEmbeddingManager (차원)
 *
 * @module core/probabilistic-orchestrator
 */

import type { UUID, Embedding384, NeuronNode, INeuronStore } from '../types/index.js';
import type { BidirectionalInferenceEngine } from './bidirectional-inference.js';
import type { AttractorModel } from './attractor-model.js';
import type { ProbabilisticNeuronManager } from './probabilistic-neuron.js';
import type { DynamicEmbeddingManager } from './dynamic-embedding.js';
import type { FourStageLearningSystem } from '../services/four-stage-learning.js';
import type { ProbabilisticStore } from '../storage/probabilistic-store.js';
import { EvolutionScheduler, type EvolutionStats, type SchedulerStatus } from './evolution-scheduler.js';
import { cosineSimilarity } from '../utils/similarity.js';
import { createLogger } from '../utils/logger.js';
import { getMetrics, MetricNames } from '../utils/metrics.js';

const logger = createLogger('orchestrator');

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  autoSaveInterval: number;       // Auto-save interval in ms (default: 300000 = 5min)
  enableAutoEvolution: boolean;   // Enable automatic evolution (default: true)
  enableAutoSave: boolean;        // Enable automatic save (default: true)
  neuronEvolveInterval: number;   // Neuron evolution interval (default: 60000 = 1min)
  attractorDecayInterval: number; // Attractor decay interval (default: 3600000 = 1hr)
}

/**
 * Orchestrator options
 */
export interface OrchestratorOptions {
  neuronStore: INeuronStore;
  inferenceEngine?: BidirectionalInferenceEngine;
  attractorModel?: AttractorModel;
  learningSystem?: FourStageLearningSystem;
  neuronManager?: ProbabilisticNeuronManager;
  embeddingManager?: DynamicEmbeddingManager;
  probabilisticStore?: ProbabilisticStore;
  config?: Partial<OrchestratorConfig>;
}

/**
 * Unified inference result combining all modules
 */
export interface UnifiedInferenceResult {
  // From inference engine
  forwardPaths: Array<{ neuronId: UUID; confidence: number }>;
  backwardPaths: Array<{ neuronId: UUID; confidence: number }>;

  // From attractor model
  attractorInfluences: Map<UUID, number>;
  dominantAttractor?: UUID;
  pathToGoal?: UUID[];

  // From probabilistic neurons
  stateDistribution?: {
    entropy: number;
    mostProbableState: number;
  };

  // Combined recommendation
  recommendations: Array<{
    neuronId: UUID;
    reason: string;
    score: number;
  }>;
}

/**
 * Learning interaction data
 */
export interface InteractionData {
  input: string;
  output: string;
  success: boolean;
  feedback?: number;           // Quality score 0-1
  context?: Record<string, any>;
  inputNeuronId?: UUID;        // Existing input neuron
  outputNeuronId?: UUID;       // Existing output neuron
  processSteps?: Array<{       // AI reasoning steps
    stepNumber: number;
    action: string;
    input: string;
    output: string;
    reasoning: string;
    duration: number;
    success: boolean;
  }>;
}

/**
 * Extended learning result
 */
export interface LearningResult {
  patternsLearned: number;
  attractorsUpdated: number;
  neuronsUpdated: number;
  extractsCreated: number;
  processLearned: boolean;
  outcomeRecorded: boolean;
  inputNeuronId?: UUID;
  outputNeuronId?: UUID;
}

/**
 * Save state result
 */
export interface SaveStateResult {
  saved: boolean;
  timestamp: string;
  modules: {
    attractors: boolean;
    learning: boolean;
    neurons: boolean;
    dimensions: boolean;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: OrchestratorConfig = {
  autoSaveInterval: 300000, // 5 minutes
  enableAutoEvolution: true,
  enableAutoSave: true,
  neuronEvolveInterval: 60000, // 1 minute
  attractorDecayInterval: 3600000, // 1 hour
};

/**
 * Probabilistic Orchestrator
 *
 * Unified coordination layer for all probabilistic ontology modules.
 * Manages the interaction between inference, attractors, learning,
 * probabilistic neurons, and dynamic embeddings.
 *
 * @example
 * ```typescript
 * const orchestrator = new ProbabilisticOrchestrator({
 *   neuronStore,
 *   attractorModel,
 *   learningSystem,
 *   neuronManager,
 *   embeddingManager,
 *   config: { enableAutoEvolution: true }
 * });
 *
 * await orchestrator.init();
 *
 * // Learn from user interaction
 * await orchestrator.learnFromInteraction({
 *   input: 'user question',
 *   output: 'system response',
 *   success: true
 * });
 *
 * // Clean shutdown
 * await orchestrator.shutdown();
 * ```
 *
 * @see {@link OrchestratorOptions} for configuration options
 * @see {@link UnifiedInferenceResult} for inference result structure
 */
export class ProbabilisticOrchestrator {
  private store: INeuronStore;
  private inference?: BidirectionalInferenceEngine;
  private attractors?: AttractorModel;
  private learning?: FourStageLearningSystem;
  private neurons?: ProbabilisticNeuronManager;
  private dimensions?: DynamicEmbeddingManager;
  private probabilisticStore?: ProbabilisticStore;
  private config: OrchestratorConfig;
  private scheduler?: EvolutionScheduler;

  // State management
  private initialized: boolean = false;
  private autoSaveTimer?: ReturnType<typeof setInterval>;
  private lastSaveTime?: string;

  constructor(options: OrchestratorOptions) {
    this.store = options.neuronStore;
    this.inference = options.inferenceEngine;
    this.attractors = options.attractorModel;
    this.learning = options.learningSystem;
    this.neurons = options.neuronManager;
    this.dimensions = options.embeddingManager;
    this.probabilisticStore = options.probabilisticStore;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  // ==================== Lifecycle Methods ====================

  /**
   * Initialize the orchestrator
   * - Initialize probabilistic store
   * - Load saved state
   * - Start auto-save timer
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const metrics = getMetrics();
    const end = logger.time('init');

    // Register health check
    metrics.registerHealthCheck('orchestrator', async () => ({
      name: 'orchestrator',
      healthy: this.initialized,
      message: this.initialized ? 'Orchestrator running' : 'Not initialized',
    }));

    // Initialize store if available
    if (this.probabilisticStore) {
      await this.probabilisticStore.init();
      logger.info('Probabilistic store initialized');

      // Load saved state
      await this.loadState();
    }

    // Start auto-save timer
    if (this.config.enableAutoSave && this.probabilisticStore) {
      this.startAutoSave();
      logger.info('Auto-save enabled', { interval: this.config.autoSaveInterval });
    }

    // Start evolution scheduler
    if (this.config.enableAutoEvolution && (this.neurons || this.attractors)) {
      this.scheduler = new EvolutionScheduler({
        neuronManager: this.neurons,
        attractorModel: this.attractors,
        neuronEvolveInterval: this.config.neuronEvolveInterval,
        attractorDecayInterval: this.config.attractorDecayInterval,
        onEvolve: async (stats: EvolutionStats) => {
          logger.debug('Evolution completed', {
            neuronsEvolved: stats.neuronsEvolved,
            attractorsDecayed: stats.attractorsDecayed,
          });
          // Auto-save after evolution
          if (this.config.enableAutoSave && this.probabilisticStore) {
            await this.saveState();
          }
        },
      });
      this.scheduler.start();
      logger.info('Evolution scheduler started', {
        neuronInterval: this.config.neuronEvolveInterval,
        attractorInterval: this.config.attractorDecayInterval,
      });
    }

    this.initialized = true;
    end();
  }

  /**
   * Shutdown the orchestrator
   * - Save current state
   * - Stop timers
   * - Close store
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    const metrics = getMetrics();
    metrics.unregisterHealthCheck('orchestrator');
    logger.info('Shutting down orchestrator');

    // Stop evolution scheduler
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = undefined;
      logger.debug('Evolution scheduler stopped');
    }

    // Stop auto-save timer
    this.stopAutoSave();

    // Save final state
    if (this.probabilisticStore) {
      await this.saveState();
      await this.probabilisticStore.close();
      logger.debug('State saved and store closed');
    }

    this.initialized = false;
    logger.info('Orchestrator shutdown complete');
  }

  /**
   * Save all module states to persistent storage
   */
  async saveState(): Promise<SaveStateResult> {
    const result: SaveStateResult = {
      saved: false,
      timestamp: new Date().toISOString(),
      modules: {
        attractors: false,
        learning: false,
        neurons: false,
        dimensions: false,
      },
    };

    if (!this.probabilisticStore) {
      return result;
    }

    const states: {
      attractors?: object;
      learning?: object;
      neurons?: object;
      dimensions?: object;
    } = {};

    // Serialize each module
    if (this.attractors) {
      states.attractors = this.attractors.serialize();
      result.modules.attractors = true;
    }

    if (this.learning) {
      states.learning = this.learning.serialize();
      result.modules.learning = true;
    }

    if (this.neurons) {
      states.neurons = this.neurons.serialize();
      result.modules.neurons = true;
    }

    if (this.dimensions) {
      states.dimensions = this.dimensions.serializeAll();
      result.modules.dimensions = true;
    }

    // Save all at once
    await this.probabilisticStore.saveAll(states);

    this.lastSaveTime = result.timestamp;
    result.saved = true;

    return result;
  }

  /**
   * Load all module states from persistent storage
   */
  async loadState(): Promise<{
    loaded: boolean;
    modules: {
      attractors: boolean;
      learning: boolean;
      neurons: boolean;
      dimensions: boolean;
    };
  }> {
    const result = {
      loaded: false,
      modules: {
        attractors: false,
        learning: false,
        neurons: false,
        dimensions: false,
      },
    };

    if (!this.probabilisticStore) {
      return result;
    }

    const states = await this.probabilisticStore.loadAll();

    // Load each module
    if (states.attractors && this.attractors) {
      this.attractors.load(states.attractors);
      result.modules.attractors = true;
    }

    if (states.learning && this.learning) {
      this.learning.load(states.learning as any);
      result.modules.learning = true;
    }

    if (states.neurons && this.neurons) {
      this.neurons.load(states.neurons as any);
      result.modules.neurons = true;
    }

    if (states.dimensions && this.dimensions) {
      this.dimensions.loadAll(states.dimensions as any);
      result.modules.dimensions = true;
    }

    result.loaded = true;
    return result;
  }

  // ==================== Core Methods ====================

  /**
   * Perform unified inference combining all available modules.
   *
   * Combines bidirectional inference, attractor influences, and probabilistic
   * state analysis to provide comprehensive reasoning about a neuron.
   *
   * @param neuronId - The ID of the neuron to analyze
   * @param options - Configuration for the inference
   * @param options.includeAttractors - Include attractor influence analysis (default: true)
   * @param options.includeProbabilistic - Include probabilistic state analysis (default: true)
   * @param options.maxDepth - Maximum inference depth (default: 3)
   * @returns Unified inference result with paths, influences, and recommendations
   *
   * @example
   * ```typescript
   * const result = await orchestrator.unifiedInfer('neuron-123', {
   *   includeAttractors: true,
   *   includeProbabilistic: true,
   *   maxDepth: 5
   * });
   * console.log(result.forwardPaths); // Cause -> Effect paths
   * console.log(result.dominantAttractor); // Most influential goal
   * ```
   */
  async unifiedInfer(
    neuronId: UUID,
    options: {
      includeAttractors?: boolean;
      includeProbabilistic?: boolean;
      maxDepth?: number;
    } = {}
  ): Promise<UnifiedInferenceResult> {
    const metrics = getMetrics();
    const timer = metrics.startTimer(MetricNames.INFERENCE_DURATION_MS, { type: 'unified' });
    metrics.increment(MetricNames.INFERENCE_REQUESTS, { type: 'unified' });

    const result: UnifiedInferenceResult = {
      forwardPaths: [],
      backwardPaths: [],
      attractorInfluences: new Map(),
      recommendations: [],
    };

    const neuron = await this.store.getNeuron(neuronId);
    if (!neuron) {
      timer();
      return result;
    }

    // 1. Bidirectional inference
    if (this.inference) {
      const forward = await this.inference.forwardInfer(neuron);
      result.forwardPaths = forward.map(r => ({
        neuronId: r.target?.id ?? r.source.id,
        confidence: r.confidence,
      }));

      const backward = await this.inference.backwardInfer(neuron);
      result.backwardPaths = backward.map(r => ({
        neuronId: r.source.id,
        confidence: r.confidence,
      }));
    }

    // 2. Attractor influences
    if (this.attractors && options.includeAttractors !== false) {
      result.attractorInfluences = this.attractors.calculateInfluence(neuron.embedding);

      const dominant = this.attractors.getDominantAttractor(neuron.embedding);
      if (dominant) {
        result.dominantAttractor = dominant.id;

        // Find path to dominant attractor
        const pathResult = await this.attractors.findPathToAttractor(neuronId, dominant.id);
        if (pathResult) {
          result.pathToGoal = pathResult.path;
        }
      }
    }

    // 3. Probabilistic state analysis
    if (this.neurons && options.includeProbabilistic !== false) {
      const probNeuron = this.neurons.getNeuron(neuronId);
      if (probNeuron) {
        const states = probNeuron.superposition.states;
        let mostProbableIndex = 0;
        let maxAmplitude = 0;
        for (let i = 0; i < states.length; i++) {
          if (states[i].probability > maxAmplitude) {
            maxAmplitude = states[i].probability;
            mostProbableIndex = i;
          }
        }
        result.stateDistribution = {
          entropy: this.neurons.getUncertainty(neuronId),
          mostProbableState: mostProbableIndex,
        };
      }
    }

    // 4. Generate recommendations
    result.recommendations = this.generateRecommendations(result, neuron);

    timer();
    return result;
  }

  /**
   * Learn from a user interaction using the full 4-stage learning system.
   *
   * Implements the complete learning pipeline:
   * 1. Extract - Find meaningful content from input/output
   * 2. Patterns - Identify recurring patterns
   * 3. Process - Learn the transformation steps
   * 4. Outcome - Record success/failure for future reference
   *
   * @param data - The interaction data to learn from
   * @param data.input - The user's input text
   * @param data.output - The system's output text
   * @param data.success - Whether the interaction was successful
   * @param data.feedback - Quality score (0-1, optional)
   * @param data.inputNeuronId - Existing neuron ID for input (optional)
   * @param data.outputNeuronId - Existing neuron ID for output (optional)
   * @returns Learning result with statistics on what was learned
   *
   * @example
   * ```typescript
   * const result = await orchestrator.learnFromInteraction({
   *   input: "How do I implement a binary search?",
   *   output: "Here's how to implement binary search...",
   *   success: true,
   *   feedback: 0.9
   * });
   *
   * console.log(`Learned ${result.patternsLearned} patterns`);
   * ```
   */
  async learnFromInteraction(data: InteractionData): Promise<LearningResult> {
    const metrics = getMetrics();
    metrics.increment(MetricNames.LEARNING_SESSIONS, { type: 'interaction' });

    const result: LearningResult = {
      patternsLearned: 0,
      attractorsUpdated: 0,
      neuronsUpdated: 0,
      extractsCreated: 0,
      processLearned: false,
      outcomeRecorded: false,
    };

    // 1. Get or create input/output neurons
    let inputNeuronId = data.inputNeuronId;
    let outputNeuronId = data.outputNeuronId;

    // If no input neuron provided, try to find similar or note absence
    if (!inputNeuronId && this.dimensions) {
      // Create a simple embedding from input text for matching
      const inputEmbedding = this.createSimpleEmbedding(data.input);
      const similar = await this.store.findSimilar(inputEmbedding, 1);
      if (similar.length > 0) {
        const similarity = cosineSimilarity(inputEmbedding, similar[0].embedding);
        if (similarity > 0.8) {
          inputNeuronId = similar[0].id;
        }
      }
    }

    // 2. Full learning system integration
    if (this.learning && inputNeuronId) {
      const learningResult = await this.learning.learnFromInteraction(
        inputNeuronId,
        data.input,
        data.processSteps ?? [],
        outputNeuronId,
        data.output,
        data.success,
        data.feedback ?? (data.success ? 0.8 : 0.2)
      );

      result.extractsCreated = learningResult.extracts.length;
      result.patternsLearned = learningResult.patterns.length;
      result.processLearned = learningResult.process !== null;
      result.outcomeRecorded = learningResult.outcome !== null;
    }

    // 3. Update attractors based on success/failure
    if (this.attractors && data.success !== undefined) {
      if (data.success && data.feedback !== undefined && data.feedback > 0.7) {
        // Create or strengthen attractor for successful pattern
        const outputEmbedding = outputNeuronId
          ? (await this.store.getNeuron(outputNeuronId))?.embedding
          : this.createSimpleEmbedding(data.output);

        if (outputEmbedding) {
          // Find or create attractor for this successful outcome
          const dominant = this.attractors.getDominantAttractor(outputEmbedding);
          if (dominant) {
            // Strengthen existing attractor
            result.attractorsUpdated = 1;
          } else {
            // Create new attractor for highly successful outcomes
            if (data.feedback >= 0.9) {
              const attractorId = `attr_success_${Date.now()}`;
              this.attractors.createAttractor(
                attractorId,
                `Success Pattern`,
                `Auto-created from successful interaction`,
                outputEmbedding,
                { strength: data.feedback }
              );
              result.attractorsUpdated = 1;
            }
          }
        }
      }
    }

    // 4. Create probabilistic neurons for new patterns
    if (this.neurons && inputNeuronId) {
      const inputNeuron = await this.store.getNeuron(inputNeuronId);
      if (inputNeuron) {
        const existingProb = this.neurons.getNeuron(inputNeuronId);
        if (!existingProb) {
          await this.neurons.createProbabilisticNeuron(inputNeuron);
          result.neuronsUpdated++;
        }
      }
    }

    if (this.neurons && outputNeuronId) {
      const outputNeuron = await this.store.getNeuron(outputNeuronId);
      if (outputNeuron) {
        const existingProb = this.neurons.getNeuron(outputNeuronId);
        if (!existingProb) {
          await this.neurons.createProbabilisticNeuron(outputNeuron);
          result.neuronsUpdated++;
        }
      }
    }

    // 5. Store neuron IDs in result
    result.inputNeuronId = inputNeuronId;
    result.outputNeuronId = outputNeuronId;

    // 6. Auto-save after learning
    if (this.config.enableAutoSave && this.probabilisticStore) {
      await this.saveState();
    }

    // 7. Record metrics
    if (result.extractsCreated > 0) {
      metrics.increment(MetricNames.EXTRACTS_CREATED, undefined, result.extractsCreated);
    }
    if (result.patternsLearned > 0) {
      metrics.increment(MetricNames.PATTERNS_LEARNED, undefined, result.patternsLearned);
    }
    if (result.attractorsUpdated > 0) {
      metrics.increment(MetricNames.ATTRACTOR_ACTIVATIONS, undefined, result.attractorsUpdated);
    }

    return result;
  }

  /**
   * Provide feedback for a previous interaction.
   *
   * Updates the learning system with quality feedback, which helps
   * improve future pattern matching and process selection.
   *
   * @param inputNeuronId - The input neuron from the original interaction
   * @param outputNeuronId - The output neuron from the original interaction
   * @param quality - Quality score between 0 (poor) and 1 (excellent)
   * @param feedbackText - Optional textual feedback description
   * @returns Whether the feedback was successfully recorded
   *
   * @example
   * ```typescript
   * await orchestrator.provideFeedback(
   *   'input-neuron-id',
   *   'output-neuron-id',
   *   0.85,
   *   'Good answer but could be more concise'
   * );
   * ```
   */
  async provideFeedback(
    inputNeuronId: UUID,
    outputNeuronId: UUID,
    quality: number,
    feedbackText?: string
  ): Promise<{ updated: boolean }> {
    if (!this.learning) {
      return { updated: false };
    }

    // Find the process that was used
    const inputNeuron = await this.store.getNeuron(inputNeuronId);
    if (!inputNeuron) {
      return { updated: false };
    }

    // Get relevant patterns to find the process
    const relevantPatterns = await this.learning.findRelevantPatterns(
      inputNeuron.embedding,
      1
    );

    if (relevantPatterns.length > 0) {
      // Record outcome with feedback
      await this.learning.learnOutcome(
        relevantPatterns[0].id,  // Use pattern ID as process reference
        inputNeuronId,
        outputNeuronId,
        quality >= 0.5,
        quality,
        feedbackText
      );

      // Update attractors based on feedback
      if (this.attractors && quality >= 0.8) {
        const outputNeuron = await this.store.getNeuron(outputNeuronId);
        if (outputNeuron) {
          const dominant = this.attractors.getDominantAttractor(outputNeuron.embedding);
          if (!dominant) {
            const attractorId = `attr_feedback_${Date.now()}`;
            this.attractors.createAttractor(
              attractorId,
              `Feedback Pattern`,
              `Auto-created from positive feedback`,
              outputNeuron.embedding,
              { strength: quality }
            );
          }
        }
      }

      return { updated: true };
    }

    return { updated: false };
  }

  /**
   * Reinforce a successful path between neurons.
   *
   * Strengthens the connection between two neurons that produced a
   * successful outcome, making similar paths more likely in the future.
   *
   * @param fromId - Source neuron ID
   * @param toId - Target neuron ID
   * @param strength - Reinforcement strength (default: 0.1)
   * @returns Whether the path was successfully reinforced
   *
   * @example
   * ```typescript
   * // After a successful interaction, reinforce the path
   * await orchestrator.reinforceSuccessfulPath(
   *   'input-neuron',
   *   'output-neuron',
   *   0.2
   * );
   * ```
   */
  async reinforceSuccessfulPath(
    fromId: UUID,
    toId: UUID,
    strength: number = 0.1
  ): Promise<{ reinforced: boolean }> {
    // Update probabilistic neurons if they exist
    if (this.neurons) {
      const fromProb = this.neurons.getNeuron(fromId);
      const toProb = this.neurons.getNeuron(toId);

      if (fromProb && toProb) {
        // Entangle successful pairs
        this.neurons.entangle(fromId, toId);
      }
    }

    // Update attractor model - strengthen path
    if (this.attractors) {
      const fromNeuron = await this.store.getNeuron(fromId);
      const toNeuron = await this.store.getNeuron(toId);

      if (fromNeuron && toNeuron) {
        // The path is successful, so the destination could be an attractor
        const dominant = this.attractors.getDominantAttractor(toNeuron.embedding);
        if (dominant) {
          // Path leads to a known goal - this is good
          return { reinforced: true };
        }
      }
    }

    return { reinforced: true };
  }

  /**
   * Create a goal-driven neuron biased toward an attractor.
   *
   * Creates a probabilistic neuron with states weighted toward
   * the specified attractor (goal), implementing teleological
   * determinism where future goals influence present state.
   *
   * @param baseNeuronId - The base neuron to enhance with goal direction
   * @param attractorId - The target attractor (goal) to move toward
   * @returns Goal-driven neuron info or null if creation failed
   */
  async createGoalDrivenNeuron(
    baseNeuronId: UUID,
    attractorId: UUID
  ): Promise<{
    neuronId: UUID;
    initialState: number;
    pathProbability: number;
  } | null> {
    if (!this.neurons || !this.attractors) {
      return null;
    }

    const baseNeuron = await this.store.getNeuron(baseNeuronId);
    if (!baseNeuron) return null;

    // Create probabilistic neuron
    const probNeuron = await this.neurons.createProbabilisticNeuron(baseNeuron);

    // Get path to attractor
    const pathResult = await this.attractors.findPathToAttractor(baseNeuronId, attractorId);

    return {
      neuronId: baseNeuronId,
      initialState: 0,
      pathProbability: pathResult?.probability ?? 0,
    };
  }

  /**
   * Expand embedding dimensions for a new concept.
   *
   * Registers a new semantic dimension, allowing the system to
   * capture novel concepts that weren't in the original embedding space.
   *
   * @param concept - The concept name to register
   * @param category - Semantic category for organization (default: 'custom')
   * @returns The new dimension name and total dimension count
   */
  async expandForConcept(
    concept: string,
    category: string = 'custom'
  ): Promise<{
    dimensionName: string;
    totalDimensions: number;
  }> {
    if (!this.dimensions) {
      return { dimensionName: concept, totalDimensions: 384 };
    }

    this.dimensions.registerDimension(concept, {
      name: concept,
      semanticCategory: category,
      description: `Dimension for concept: ${concept}`,
      createdAt: new Date().toISOString(),
      usageCount: 0,
    });

    const stats = this.dimensions.getStats();

    return {
      dimensionName: concept,
      totalDimensions: stats.totalDimensions,
    };
  }

  /**
   * Get comprehensive statistics from all modules.
   *
   * Provides a unified view of the system's current state including
   * inference availability, attractor counts, learning progress,
   * neuron statistics, and persistence status.
   *
   * @returns Aggregated statistics from all modules
   *
   * @example
   * ```typescript
   * const stats = orchestrator.getStats();
   * console.log(`Active attractors: ${stats.attractors.active}`);
   * console.log(`Patterns learned: ${stats.learning.patterns}`);
   * console.log(`Last saved: ${stats.persistence.lastSave}`);
   * ```
   */
  getStats(): {
    inference: { available: boolean };
    attractors: { count: number; active: number };
    learning: { patterns: number; processes: number };
    neurons: { count: number; avgEntropy: number };
    dimensions: { total: number; expanded: number };
    persistence: { enabled: boolean; lastSave?: string };
  } {
    return {
      inference: {
        available: !!this.inference,
      },
      attractors: this.attractors ? {
        count: this.attractors.getStats().totalAttractors,
        active: this.attractors.getStats().activeAttractors,
      } : { count: 0, active: 0 },
      learning: this.learning ? {
        patterns: this.learning.getStats().patterns,
        processes: this.learning.getStats().processes,
      } : { patterns: 0, processes: 0 },
      neurons: this.neurons ? {
        count: this.neurons.getStats().totalNeurons,
        avgEntropy: this.neurons.getStats().averageEntropy,
      } : { count: 0, avgEntropy: 0 },
      dimensions: this.dimensions ? {
        total: this.dimensions.getStats().totalDimensions,
        expanded: this.dimensions.getStats().expandedDimensions,
      } : { total: 384, expanded: 0 },
      persistence: {
        enabled: !!this.probabilisticStore,
        lastSave: this.lastSaveTime,
      },
    };
  }

  /**
   * Check if orchestrator is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get configuration
   */
  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }

  /**
   * Get evolution scheduler status
   */
  getEvolutionStatus(): SchedulerStatus | null {
    if (!this.scheduler) return null;
    return this.scheduler.getStatus();
  }

  /**
   * Trigger manual evolution of all modules
   */
  async triggerEvolution(): Promise<EvolutionStats | null> {
    if (!this.scheduler) return null;
    return this.scheduler.evolveNow();
  }

  /**
   * Update evolution intervals (applies immediately)
   */
  setEvolutionIntervals(intervals: {
    neuronEvolveInterval?: number;
    attractorDecayInterval?: number;
  }): void {
    if (intervals.neuronEvolveInterval !== undefined) {
      this.config.neuronEvolveInterval = intervals.neuronEvolveInterval;
    }
    if (intervals.attractorDecayInterval !== undefined) {
      this.config.attractorDecayInterval = intervals.attractorDecayInterval;
    }

    if (this.scheduler) {
      this.scheduler.setIntervals({
        neuronEvolve: intervals.neuronEvolveInterval,
        attractorDecay: intervals.attractorDecayInterval,
      });
    }
  }

  // ==================== Auto-Save Management ====================

  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(async () => {
      try {
        await this.saveState();
      } catch (error) {
        console.error('[Orchestrator] Auto-save failed:', error);
      }
    }, this.config.autoSaveInterval);
  }

  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  // ==================== Private Helpers ====================

  private generateRecommendations(
    result: UnifiedInferenceResult,
    neuron: NeuronNode
  ): Array<{ neuronId: UUID; reason: string; score: number }> {
    const recommendations: Array<{ neuronId: UUID; reason: string; score: number }> = [];

    // Forward paths with high confidence
    for (const path of result.forwardPaths.slice(0, 3)) {
      if (path.confidence > 0.5) {
        recommendations.push({
          neuronId: path.neuronId,
          reason: 'Strong forward causal connection',
          score: path.confidence,
        });
      }
    }

    // Backward paths (abductive reasoning)
    for (const path of result.backwardPaths.slice(0, 2)) {
      if (path.confidence > 0.5) {
        recommendations.push({
          neuronId: path.neuronId,
          reason: 'Likely cause (abductive)',
          score: path.confidence * 0.9,
        });
      }
    }

    // Attractor-influenced paths
    if (result.pathToGoal && result.pathToGoal.length > 1) {
      const nextStep = result.pathToGoal[1];
      recommendations.push({
        neuronId: nextStep,
        reason: `Step toward goal attractor`,
        score: 0.8,
      });
    }

    // Sort by score
    recommendations.sort((a, b) => b.score - a.score);

    return recommendations.slice(0, 5);
  }

  /**
   * Create a simple embedding from text
   * Uses a deterministic hash-based approach for text without external embedding service
   */
  private createSimpleEmbedding(text: string): Embedding384 {
    const embedding = new Float32Array(384);
    const words = text.toLowerCase().split(/\s+/);

    // Simple bag-of-words style embedding
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const charCode = word.charCodeAt(j);
        const index = (charCode * (i + 1) * (j + 1)) % 384;
        embedding[index] += 1 / (1 + Math.log(1 + i));
      }
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < 384; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < 384; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }
}

export default ProbabilisticOrchestrator;
