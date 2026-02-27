/**
 * Four-Stage Learning System
 *
 * Based on Probabilistic Ontology Framework:
 * Stage 1: Extract Meaningful - 유의미 추출
 * Stage 2: Learn Patterns - 패턴 학습
 * Stage 3: Learn Process - 과정 학습 (AI reasoning process)
 * Stage 4: Learn Outcomes - 결과 학습
 *
 * Extended with:
 * - EventEmitter for real-time progress updates
 * - Streaming session support
 * - Auto-persistence
 *
 * @module services/four-stage-learning
 */

import { EventEmitter } from 'events';
import type {
  UUID,
  NeuronNode,
  Synapse,
  Embedding384,
  INeuronStore
} from '../types/index.js';
import { NeuronGraphManager } from '../core/neuron-graph.js';
import { cosineSimilarity } from '../utils/similarity.js';
import { generateUUID } from '../utils/uuid.js';
import type { ProbabilisticStore } from '../storage/probabilistic-store.js';
import { TextEmbeddingService, type EmbeddingProviderConfig } from './text-embedding.js';

/**
 * Learning Stage enum
 */
export type LearningStage = 'extract' | 'patterns' | 'process' | 'outcomes';

/**
 * Extracted meaningful content
 */
export interface MeaningfulExtract {
  id: UUID;
  content: string;
  embedding: Embedding384;
  importance: number;
  category: string;
  sourceNeuronId: UUID;
  extractedAt: string;
  keywords: string[];
}

/**
 * Learned pattern
 */
export interface LearnedPattern {
  id: UUID;
  name: string;
  description: string;
  instances: UUID[];          // MeaningfulExtract IDs
  centroid: Embedding384;     // Average embedding
  frequency: number;
  confidence: number;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * Process step in reasoning
 */
export interface ProcessStep {
  stepNumber: number;
  action: string;
  input: string;
  output: string;
  reasoning: string;
  duration: number;
  success: boolean;
}

/**
 * Learned process (AI reasoning chain)
 */
export interface LearnedProcess {
  id: UUID;
  name: string;
  taskType: string;
  steps: ProcessStep[];
  inputPattern: UUID;         // Pattern that triggers this process
  outputPattern?: UUID;       // Expected output pattern
  successRate: number;
  totalExecutions: number;
  averageDuration: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Outcome record
 */
export interface OutcomeRecord {
  id: UUID;
  processId: UUID;
  inputNeuronId: UUID;
  outputNeuronId?: UUID;
  success: boolean;
  quality: number;            // 0-1 quality score
  feedback?: string;
  timestamp: string;
}

/**
 * Learning session
 */
export interface LearningSession {
  id: UUID;
  startedAt: string;
  endedAt?: string;
  stages: {
    extract: MeaningfulExtract[];
    patterns: LearnedPattern[];
    processes: LearnedProcess[];
    outcomes: OutcomeRecord[];
  };
  metrics: {
    totalExtracts: number;
    patternsDiscovered: number;
    processesLearned: number;
    outcomeSuccess: number;
  };
}

/**
 * Four Stage Learning Options
 */
export interface FourStageLearningOptions {
  neuronStore: INeuronStore;
  graphManager: NeuronGraphManager;
  importanceThreshold?: number;
  patternMinInstances?: number;
  enableProcessLearning?: boolean;
  /** Embedding provider configuration */
  embeddingConfig?: Partial<EmbeddingProviderConfig>;
  /** Use real embeddings instead of mock (default: true) */
  useRealEmbeddings?: boolean;
}

/**
 * Learning progress event payload
 */
export interface LearningProgressEvent {
  /** Session ID */
  sessionId: UUID;
  /** Current learning stage */
  stage: LearningStage;
  /** Current item index */
  current: number;
  /** Total items to process */
  total: number;
  /** Progress percentage (0-100) */
  percentage: number;
  /** Optional status message */
  message?: string;
  /** Optional data */
  data?: unknown;
}

/**
 * Learning event types
 */
export interface LearningEvents {
  'session:start': LearningSession;
  'session:end': LearningSession;
  'progress': LearningProgressEvent;
  'extract': MeaningfulExtract;
  'pattern': LearnedPattern;
  'process': LearnedProcess;
  'outcome': OutcomeRecord;
  'error': { sessionId?: UUID; error: Error; stage?: LearningStage };
}

/**
 * Four-Stage Learning System
 *
 * Implements the complete learning loop based on probabilistic ontology:
 * 1. **Extract Meaningful (유의미 추출)**: Identify important content segments
 * 2. **Learn Patterns (패턴 학습)**: Discover recurring patterns from extracts
 * 3. **Learn Process (과정 학습)**: Capture AI reasoning chains
 * 4. **Learn Outcomes (결과 학습)**: Record and reinforce successful paths
 *
 * @example
 * ```typescript
 * const learning = new FourStageLearningSystem({
 *   neuronStore: store,
 *   graphManager: graph
 * });
 *
 * // Start a learning session
 * const session = learning.startSession();
 *
 * // Stage 1: Extract meaningful content
 * const extracts = await learning.extractMeaningful(neuronId, content);
 *
 * // Stage 2: Learn patterns from extracts
 * const patterns = await learning.learnPatterns(extracts.map(e => e.id));
 *
 * // Stage 3: Learn the reasoning process
 * const process = await learning.learnProcess('search', processSteps);
 *
 * // Stage 4: Record outcome
 * const outcome = await learning.learnOutcome(
 *   process.id, inputId, outputId, true, 0.9
 * );
 *
 * // End session and get metrics
 * const finalSession = learning.endSession();
 * console.log(`Patterns discovered: ${finalSession.metrics.patternsDiscovered}`);
 * ```
 *
 * @see {@link MeaningfulExtract} for extract structure
 * @see {@link LearnedPattern} for pattern structure
 * @see {@link LearnedProcess} for process structure
 */
export class FourStageLearningSystem extends EventEmitter {
  private store: INeuronStore;
  private graphManager: NeuronGraphManager;
  private importanceThreshold: number;
  private patternMinInstances: number;
  private processLearningEnabled: boolean;

  // Real embedding service
  private embeddingService: TextEmbeddingService;
  private useRealEmbeddings: boolean;

  // Storage for learned components
  private extracts: Map<UUID, MeaningfulExtract> = new Map();
  private patterns: Map<UUID, LearnedPattern> = new Map();
  private processes: Map<UUID, LearnedProcess> = new Map();
  private outcomes: Map<UUID, OutcomeRecord> = new Map();

  // Current learning session
  private currentSession: LearningSession | null = null;

  // Auto-persistence
  private autoPersistStore: ProbabilisticStore | null = null;
  private autoPersistInterval: NodeJS.Timeout | null = null;
  private autoPersistEnabled: boolean = false;

  constructor(options: FourStageLearningOptions) {
    super();
    this.store = options.neuronStore;
    this.graphManager = options.graphManager;
    this.importanceThreshold = options.importanceThreshold ?? 0.3;
    this.patternMinInstances = options.patternMinInstances ?? 3;
    this.processLearningEnabled = options.enableProcessLearning ?? true;
    this.useRealEmbeddings = options.useRealEmbeddings ?? true;

    // Initialize embedding service
    this.embeddingService = new TextEmbeddingService(options.embeddingConfig ?? {
      type: 'local'
    });

    this.setMaxListeners(50);
  }

  /**
   * Start a new learning session.
   *
   * A session tracks all learning activities (extracts, patterns,
   * processes, outcomes) and provides metrics upon completion.
   *
   * @returns The new LearningSession object
   *
   * @example
   * ```typescript
   * const session = learning.startSession();
   * // ... perform learning activities ...
   * const endedSession = learning.endSession();
   * ```
   */
  startSession(): LearningSession {
    this.currentSession = {
      id: generateUUID(),
      startedAt: new Date().toISOString(),
      stages: {
        extract: [],
        patterns: [],
        processes: [],
        outcomes: []
      },
      metrics: {
        totalExtracts: 0,
        patternsDiscovered: 0,
        processesLearned: 0,
        outcomeSuccess: 0
      }
    };

    this.emit('session:start', this.currentSession);
    return this.currentSession;
  }

  /**
   * Emit a progress event
   */
  private emitProgress(
    stage: LearningStage,
    current: number,
    total: number,
    message?: string,
    data?: unknown
  ): void {
    if (!this.currentSession) return;

    const event: LearningProgressEvent = {
      sessionId: this.currentSession.id,
      stage,
      current,
      total,
      percentage: total > 0 ? (current / total) * 100 : 0,
      message,
      data,
    };

    this.emit('progress', event);
  }

  /**
   * End current learning session
   */
  endSession(): LearningSession | null {
    if (!this.currentSession) return null;

    this.currentSession.endedAt = new Date().toISOString();

    // Calculate final metrics
    this.currentSession.metrics = {
      totalExtracts: this.currentSession.stages.extract.length,
      patternsDiscovered: this.currentSession.stages.patterns.length,
      processesLearned: this.currentSession.stages.processes.length,
      outcomeSuccess: this.calculateSuccessRate(this.currentSession.stages.outcomes)
    };

    const session = this.currentSession;
    this.currentSession = null;

    this.emit('session:end', session);

    // Persist data before clearing to prevent data loss
    if (this.autoPersistEnabled) {
      this.persistNow()
        .catch((err) => { this.emit('error', { error: err as Error }); })
        .finally(() => {
          this.clearSessionData();
          this.emit('memory:cleared', {});
        });
    } else {
      this.clearSessionData();
    }

    return session;
  }

  /**
   * Clear session data to free memory
   * Call this after endSession() or when you need to reset state
   */
  clearSessionData(): void {
    const previousSizes = {
      extracts: this.extracts.size,
      patterns: this.patterns.size,
      processes: this.processes.size,
      outcomes: this.outcomes.size
    };

    this.extracts.clear();
    this.patterns.clear();
    this.processes.clear();
    this.outcomes.clear();

    this.emit('memory:cleared', previousSizes);
  }

  /**
   * Get current memory usage stats
   */
  getMemoryStats(): { extracts: number; patterns: number; processes: number; outcomes: number } {
    return {
      extracts: this.extracts.size,
      patterns: this.patterns.size,
      processes: this.processes.size,
      outcomes: this.outcomes.size
    };
  }

  // ==================== Stage 1: Extract Meaningful ====================

  /**
   * Stage 1: Extract meaningful content from a neuron.
   *
   * Segments content into semantic units and evaluates importance.
   * Only segments exceeding the importance threshold are extracted.
   * Categories include: causal, conditional, procedural, definitional, general.
   *
   * @param neuronId - Source neuron ID
   * @param content - Text content to extract meaningful segments from
   * @returns Array of meaningful extracts with embeddings and keywords
   *
   * @example
   * ```typescript
   * const extracts = await learning.extractMeaningful(
   *   'neuron-1',
   *   'TypeScript is a typed superset of JavaScript. Because it adds static typing, it helps catch errors at compile time.'
   * );
   * // May return:
   * // [{ category: 'definitional', content: 'TypeScript is...' },
   * //  { category: 'causal', content: 'Because it adds...' }]
   * ```
   */
  async extractMeaningful(
    neuronId: UUID,
    content: string
  ): Promise<MeaningfulExtract[]> {
    const neuron = await this.store.getNeuron(neuronId);
    if (!neuron) return [];

    const extracts: MeaningfulExtract[] = [];

    // Segment content into meaningful units
    const segments = this.segmentContent(content);
    const total = segments.length;

    this.emitProgress('extract', 0, total, 'Starting extraction...');

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      // Calculate importance
      const importance = this.calculateImportance(segment, neuron);

      if (importance >= this.importanceThreshold) {
        const extract: MeaningfulExtract = {
          id: generateUUID(),
          content: segment.text,
          embedding: await this.generateSegmentEmbedding(segment.text, neuron.embedding),
          importance,
          category: segment.category,
          sourceNeuronId: neuronId,
          extractedAt: new Date().toISOString(),
          keywords: this.extractKeywords(segment.text)
        };

        this.extracts.set(extract.id, extract);
        extracts.push(extract);

        this.emit('extract', extract);

        if (this.currentSession) {
          this.currentSession.stages.extract.push(extract);
        }
      }

      this.emitProgress('extract', i + 1, total, `Processed segment ${i + 1}/${total}`);
    }

    return extracts;
  }

  // ==================== Stage 2: Learn Patterns ====================

  /**
   * Stage 2: Learn patterns from extracts.
   *
   * Clusters similar extracts and identifies recurring patterns.
   * Existing patterns are updated with new instances; new patterns
   * are created when clusters don't match existing ones.
   *
   * @param extractIds - Array of MeaningfulExtract IDs to analyze
   * @returns Array of learned or updated patterns
   *
   * @example
   * ```typescript
   * const patterns = await learning.learnPatterns([
   *   'extract-1', 'extract-2', 'extract-3'
   * ]);
   *
   * for (const pattern of patterns) {
   *   console.log(`${pattern.name}: ${pattern.instances.length} instances`);
   *   console.log(`Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
   * }
   * ```
   */
  async learnPatterns(
    extractIds: UUID[]
  ): Promise<LearnedPattern[]> {
    const extracts = extractIds
      .map(id => this.extracts.get(id))
      .filter((e): e is MeaningfulExtract => e !== undefined);

    if (extracts.length < this.patternMinInstances) {
      return [];
    }

    this.emitProgress('patterns', 0, 1, 'Clustering extracts...');

    // Cluster extracts by similarity
    const clusters = this.clusterExtracts(extracts);
    const newPatterns: LearnedPattern[] = [];
    const total = clusters.length;

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      if (cluster.length < this.patternMinInstances) continue;

      // Check if pattern already exists
      const existingPattern = this.findSimilarPattern(cluster);

      if (existingPattern) {
        // Update existing pattern
        existingPattern.instances.push(...cluster.map(e => e.id));
        existingPattern.frequency = existingPattern.instances.length;
        existingPattern.lastSeenAt = new Date().toISOString();
        existingPattern.centroid = this.calculateCentroid(
          cluster.map(e => e.embedding)
        );
        newPatterns.push(existingPattern);
        this.emit('pattern', existingPattern);
      } else {
        // Create new pattern
        const pattern: LearnedPattern = {
          id: generateUUID(),
          name: this.generatePatternName(cluster),
          description: this.generatePatternDescription(cluster),
          instances: cluster.map(e => e.id),
          centroid: this.calculateCentroid(cluster.map(e => e.embedding)),
          frequency: cluster.length,
          confidence: this.calculatePatternConfidence(cluster),
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString()
        };

        this.patterns.set(pattern.id, pattern);
        newPatterns.push(pattern);
        this.emit('pattern', pattern);

        if (this.currentSession) {
          this.currentSession.stages.patterns.push(pattern);
        }
      }

      this.emitProgress('patterns', i + 1, total, `Analyzed cluster ${i + 1}/${total}`);
    }

    return newPatterns;
  }

  // ==================== Stage 3: Learn Process ====================

  /**
   * Stage 3: Learn reasoning process from execution trace.
   *
   * Captures the AI's reasoning chain as a reusable process template.
   * Similar processes are merged to increase confidence; new task
   * types create new process templates.
   *
   * @param taskType - Type of task (e.g., 'search', 'create', 'explain')
   * @param steps - Array of ProcessStep objects from execution
   * @param inputPatternId - Optional ID of triggering pattern
   * @returns The learned or updated process, or null if disabled/empty
   *
   * @example
   * ```typescript
   * const process = await learning.learnProcess('explain', [
   *   { stepNumber: 1, action: 'analyze', input: 'question', output: 'concepts', reasoning: '...', duration: 100, success: true },
   *   { stepNumber: 2, action: 'synthesize', input: 'concepts', output: 'explanation', reasoning: '...', duration: 200, success: true }
   * ]);
   *
   * if (process) {
   *   console.log(`Success rate: ${(process.successRate * 100).toFixed(0)}%`);
   * }
   * ```
   */
  async learnProcess(
    taskType: string,
    steps: ProcessStep[],
    inputPatternId?: UUID
  ): Promise<LearnedProcess | null> {
    if (!this.processLearningEnabled) return null;
    if (steps.length === 0) return null;

    // Check if similar process exists
    const existingProcess = this.findSimilarProcess(taskType, steps);

    if (existingProcess) {
      // Update existing process
      existingProcess.totalExecutions++;
      existingProcess.successRate = this.updateSuccessRate(
        existingProcess,
        steps.every(s => s.success)
      );
      existingProcess.averageDuration = this.updateAverageDuration(
        existingProcess,
        steps.reduce((sum, s) => sum + s.duration, 0)
      );
      existingProcess.updatedAt = new Date().toISOString();
      return existingProcess;
    }

    // Create new process
    const process: LearnedProcess = {
      id: generateUUID(),
      name: `${taskType}_process_${Date.now()}`,
      taskType,
      steps: this.normalizeSteps(steps),
      inputPattern: inputPatternId ?? generateUUID(),
      successRate: steps.every(s => s.success) ? 1.0 : 0.0,
      totalExecutions: 1,
      averageDuration: steps.reduce((sum, s) => sum + s.duration, 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.processes.set(process.id, process);

    if (this.currentSession) {
      this.currentSession.stages.processes.push(process);
    }

    return process;
  }

  // ==================== Stage 4: Learn Outcomes ====================

  /**
   * Stage 4: Learn from outcomes.
   *
   * Records the result of a process execution and reinforces
   * successful paths in the neuron graph. This creates a feedback
   * loop for continuous improvement.
   *
   * @param processId - ID of the executed process
   * @param inputNeuronId - Input neuron that triggered the process
   * @param outputNeuronId - Output neuron (if any) produced
   * @param success - Whether the outcome was successful
   * @param quality - Quality score (0-1)
   * @param feedback - Optional textual feedback
   * @returns The recorded OutcomeRecord
   *
   * @example
   * ```typescript
   * const outcome = await learning.learnOutcome(
   *   'process-1',
   *   'input-neuron',
   *   'output-neuron',
   *   true,
   *   0.95,
   *   'Excellent response'
   * );
   * ```
   */
  async learnOutcome(
    processId: UUID,
    inputNeuronId: UUID,
    outputNeuronId: UUID | undefined,
    success: boolean,
    quality: number,
    feedback?: string
  ): Promise<OutcomeRecord> {
    const outcome: OutcomeRecord = {
      id: generateUUID(),
      processId,
      inputNeuronId,
      outputNeuronId,
      success,
      quality,
      feedback,
      timestamp: new Date().toISOString()
    };

    this.outcomes.set(outcome.id, outcome);

    // Update process success rate
    const process = this.processes.get(processId);
    if (process) {
      process.successRate = this.updateSuccessRate(process, success);
      process.updatedAt = new Date().toISOString();
    }

    // If successful, strengthen connections
    if (success && outputNeuronId) {
      await this.reinforceSuccessfulPath(inputNeuronId, outputNeuronId);
    }

    if (this.currentSession) {
      this.currentSession.stages.outcomes.push(outcome);
    }

    return outcome;
  }

  // ==================== Full Learning Loop ====================

  /**
   * Execute full 4-stage learning loop.
   *
   * Convenience method that runs all four stages sequentially:
   * extract → patterns → process → outcome. Use this for
   * complete interaction learning with a single call.
   *
   * @param inputNeuronId - ID of the input neuron
   * @param inputContent - Input text content
   * @param processSteps - Reasoning steps taken
   * @param outputNeuronId - Optional output neuron ID
   * @param outputContent - Optional output text content
   * @param success - Optional success indicator
   * @param quality - Optional quality score (0-1)
   * @returns Complete learning results from all four stages
   *
   * @example
   * ```typescript
   * const result = await learning.learnFromInteraction(
   *   inputNeuronId,
   *   'How do I sort an array?',
   *   [{ action: 'search', ... }, { action: 'explain', ... }],
   *   outputNeuronId,
   *   'Here is how to sort...',
   *   true,
   *   0.9
   * );
   *
   * console.log(`Extracts: ${result.extracts.length}`);
   * console.log(`Patterns: ${result.patterns.length}`);
   * ```
   */
  async learnFromInteraction(
    inputNeuronId: UUID,
    inputContent: string,
    processSteps: ProcessStep[],
    outputNeuronId?: UUID,
    outputContent?: string,
    success?: boolean,
    quality?: number
  ): Promise<{
    extracts: MeaningfulExtract[];
    patterns: LearnedPattern[];
    process: LearnedProcess | null;
    outcome: OutcomeRecord | null;
  }> {
    // Stage 1: Extract meaningful from input
    const inputExtracts = await this.extractMeaningful(inputNeuronId, inputContent);

    // Stage 1b: Extract from output if available
    let outputExtracts: MeaningfulExtract[] = [];
    if (outputNeuronId && outputContent) {
      outputExtracts = await this.extractMeaningful(outputNeuronId, outputContent);
    }

    const allExtracts = [...inputExtracts, ...outputExtracts];

    // Stage 2: Learn patterns
    const patterns = await this.learnPatterns(allExtracts.map(e => e.id));

    // Stage 3: Learn process
    const process = await this.learnProcess(
      this.inferTaskType(inputContent),
      processSteps,
      patterns[0]?.id
    );

    // Stage 4: Learn outcome
    let outcome: OutcomeRecord | null = null;
    if (process && success !== undefined) {
      outcome = await this.learnOutcome(
        process.id,
        inputNeuronId,
        outputNeuronId,
        success,
        quality ?? (success ? 0.8 : 0.2)
      );
    }

    return {
      extracts: allExtracts,
      patterns,
      process,
      outcome
    };
  }

  // ==================== Query Methods ====================

  /**
   * Get patterns relevant to a query
   */
  async findRelevantPatterns(
    queryEmbedding: Embedding384,
    topK: number = 5
  ): Promise<LearnedPattern[]> {
    const scored = Array.from(this.patterns.values())
      .map(pattern => ({
        pattern,
        score: cosineSimilarity(queryEmbedding, pattern.centroid)
      }))
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(s => s.pattern);
  }

  /**
   * Get process for a task type
   */
  getProcessForTask(taskType: string): LearnedProcess | null {
    for (const process of this.processes.values()) {
      if (process.taskType === taskType && process.successRate > 0.7) {
        return process;
      }
    }
    return null;
  }

  /**
   * Get learning statistics
   */
  getStats(): {
    extracts: number;
    patterns: number;
    processes: number;
    outcomes: number;
    averagePatternConfidence: number;
    averageProcessSuccess: number;
  } {
    let totalConfidence = 0;
    for (const pattern of this.patterns.values()) {
      totalConfidence += pattern.confidence;
    }

    let totalSuccess = 0;
    for (const process of this.processes.values()) {
      totalSuccess += process.successRate;
    }

    return {
      extracts: this.extracts.size,
      patterns: this.patterns.size,
      processes: this.processes.size,
      outcomes: this.outcomes.size,
      averagePatternConfidence: this.patterns.size > 0
        ? totalConfidence / this.patterns.size
        : 0,
      averageProcessSuccess: this.processes.size > 0
        ? totalSuccess / this.processes.size
        : 0
    };
  }

  // ==================== Private Methods ====================

  private segmentContent(content: string): Array<{
    text: string;
    category: string;
  }> {
    // Split by sentences and meaningful boundaries
    const segments: Array<{ text: string; category: string }> = [];

    // Split by paragraphs first
    const paragraphs = content.split(/\n\n+/);

    for (const para of paragraphs) {
      // Split by sentences
      const sentences = para.split(/(?<=[.!?。！？])\s+/);

      for (const sentence of sentences) {
        if (sentence.trim().length < 10) continue;

        segments.push({
          text: sentence.trim(),
          category: this.categorizeSegment(sentence)
        });
      }
    }

    return segments;
  }

  private categorizeSegment(text: string): string {
    const lower = text.toLowerCase();

    if (/\b(because|therefore|thus|hence|so)\b/.test(lower) ||
        /때문에|따라서|그러므로/.test(text)) {
      return 'causal';
    }
    if (/\b(if|when|unless|condition)\b/.test(lower) ||
        /만약|조건|경우/.test(text)) {
      return 'conditional';
    }
    if (/\b(how to|steps|process|method)\b/.test(lower) ||
        /방법|절차|과정/.test(text)) {
      return 'procedural';
    }
    if (/\b(is|are|was|were|definition)\b/.test(lower) ||
        /은|는|이다|정의/.test(text)) {
      return 'definitional';
    }

    return 'general';
  }

  private calculateImportance(
    segment: { text: string; category: string },
    neuron: NeuronNode
  ): number {
    let importance = 0.5;

    // Category bonus
    const categoryWeights: Record<string, number> = {
      'causal': 0.3,
      'procedural': 0.25,
      'conditional': 0.2,
      'definitional': 0.15,
      'general': 0
    };
    importance += categoryWeights[segment.category] ?? 0;

    // Length bonus (longer usually more informative, up to a point)
    const wordCount = segment.text.split(/\s+/).length;
    importance += Math.min(0.2, wordCount / 100);

    // Access count bonus from source neuron
    importance += Math.min(0.1, neuron.metadata.accessCount / 100);

    return Math.min(1, importance);
  }

  /**
   * Generate semantic embedding for a text segment.
   *
   * Uses the TextEmbeddingService with multiple strategies:
   * 1. TF-IDF weighted word vectors
   * 2. Character n-gram hashing
   * 3. Positional encoding
   * 4. Semantic category detection
   * 5. Context blending with base embedding
   *
   * Falls back to simple hash-based embedding if disabled.
   */
  private async generateSegmentEmbedding(
    segmentText: string,
    baseEmbedding: Embedding384
  ): Promise<Embedding384> {
    // Use real embedding service if enabled
    if (this.useRealEmbeddings) {
      try {
        const response = await this.embeddingService.embed({
          text: segmentText,
          contextEmbedding: baseEmbedding
        });

        // Blend with context for coherence
        const blended = new Float32Array(baseEmbedding.length);
        for (let i = 0; i < blended.length; i++) {
          // 80% from embedding service, 20% context
          blended[i] = response.embedding[i] * 0.8 + baseEmbedding[i] * 0.2;
        }

        // Normalize
        let norm = 0;
        for (let i = 0; i < blended.length; i++) {
          norm += blended[i] * blended[i];
        }
        norm = Math.sqrt(norm);
        if (norm > 0) {
          for (let i = 0; i < blended.length; i++) {
            blended[i] /= norm;
          }
        }

        return blended;
      } catch (error) {
        // Fallback to hash-based embedding on error
        this.emit('error', {
          error: error as Error,
          stage: 'extract' as LearningStage
        });
      }
    }

    // Fallback: hash-based embedding
    const embedding = new Float32Array(baseEmbedding.length);

    let hash = 0;
    for (let i = 0; i < segmentText.length; i++) {
      hash = ((hash << 5) - hash) + segmentText.charCodeAt(i);
      hash |= 0;
    }

    for (let i = 0; i < embedding.length; i++) {
      // Mix base embedding with text-derived values
      embedding[i] = baseEmbedding[i] * 0.7 +
        (((hash >> (i % 32)) & 0xFF) / 255 - 0.5) * 0.3;
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }

    return embedding;
  }

  /**
   * Update embedding service vocabulary from corpus
   */
  updateEmbeddingVocabulary(documents: string[]): void {
    this.embeddingService.updateVocabulary(documents);
  }

  /**
   * Get embedding service statistics
   */
  getEmbeddingStats(): {
    vocabularySize: number;
    cacheSize: number;
    wordVectorCount: number;
    documentCount: number;
  } {
    return this.embeddingService.getStats();
  }

  /**
   * Configure embedding provider (for API-based embeddings)
   */
  configureEmbeddingProvider(config: Partial<EmbeddingProviderConfig>): void {
    this.embeddingService = new TextEmbeddingService(config);
  }

  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);

    const stopwords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      '이', '가', '은', '는', '을', '를', '의', '에', '에서'
    ]);

    return words.filter(w => !stopwords.has(w)).slice(0, 10);
  }

  /**
   * Cluster extracts using optimized K-means style algorithm
   * Complexity: O(k * n * d) instead of O(n²)
   * Where k = number of clusters, n = number of extracts, d = embedding dimension
   */
  private clusterExtracts(
    extracts: MeaningfulExtract[],
    similarityThreshold: number = 0.7
  ): MeaningfulExtract[][] {
    if (extracts.length === 0) return [];
    if (extracts.length === 1) return [[extracts[0]]];

    // Phase 1: Initialize clusters with well-separated seeds
    // Use farthest-first traversal to select initial centroids - O(k*n)
    const k = Math.min(
      Math.ceil(Math.sqrt(extracts.length)),  // sqrt(n) clusters
      Math.ceil(extracts.length / 3)          // at least 3 items per cluster
    );

    const centroids: Embedding384[] = [];
    const centroidIndices: number[] = [];

    // First centroid: random (use first element)
    centroids.push(extracts[0].embedding);
    centroidIndices.push(0);

    // Remaining centroids: farthest from existing centroids
    for (let i = 1; i < k; i++) {
      let maxMinDist = -1;
      let farthestIdx = 0;

      for (let j = 0; j < extracts.length; j++) {
        if (centroidIndices.includes(j)) continue;

        // Find minimum distance to any existing centroid
        let minDist = Infinity;
        for (const centroid of centroids) {
          const sim = cosineSimilarity(extracts[j].embedding, centroid);
          const dist = 1 - sim;
          if (dist < minDist) minDist = dist;
        }

        if (minDist > maxMinDist) {
          maxMinDist = minDist;
          farthestIdx = j;
        }
      }

      centroids.push(extracts[farthestIdx].embedding);
      centroidIndices.push(farthestIdx);
    }

    // Phase 2: Assign each extract to nearest centroid - O(k*n)
    const clusters: MeaningfulExtract[][] = Array.from({ length: k }, () => []);
    const assignments = new Map<UUID, number>();

    for (const extract of extracts) {
      let bestCluster = 0;
      let bestSimilarity = -1;

      for (let i = 0; i < centroids.length; i++) {
        const sim = cosineSimilarity(extract.embedding, centroids[i]);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestCluster = i;
        }
      }

      // Only assign if similarity meets threshold
      if (bestSimilarity >= similarityThreshold) {
        clusters[bestCluster].push(extract);
        assignments.set(extract.id, bestCluster);
      } else {
        // Create new single-item cluster for outliers
        clusters.push([extract]);
      }
    }

    // Phase 3: Refine centroids and reassign (1 iteration) - O(k*n)
    const refinedCentroids = clusters
      .filter(c => c.length > 0)
      .map(cluster => this.calculateCentroid(cluster.map(e => e.embedding)));

    // Final assignment with refined centroids
    const finalClusters: MeaningfulExtract[][] = Array.from(
      { length: refinedCentroids.length },
      () => []
    );

    for (const extract of extracts) {
      let bestCluster = 0;
      let bestSimilarity = -1;

      for (let i = 0; i < refinedCentroids.length; i++) {
        const sim = cosineSimilarity(extract.embedding, refinedCentroids[i]);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestCluster = i;
        }
      }

      finalClusters[bestCluster].push(extract);
    }

    // Remove empty clusters
    return finalClusters.filter(c => c.length > 0);
  }

  private findSimilarPattern(cluster: MeaningfulExtract[]): LearnedPattern | null {
    const centroid = this.calculateCentroid(cluster.map(e => e.embedding));

    for (const pattern of this.patterns.values()) {
      const similarity = cosineSimilarity(centroid, pattern.centroid);
      if (similarity > 0.85) {
        return pattern;
      }
    }

    return null;
  }

  private calculateCentroid(embeddings: Embedding384[]): Embedding384 {
    if (embeddings.length === 0) {
      return new Float32Array(384);
    }

    const centroid = new Float32Array(embeddings[0].length);

    for (const embedding of embeddings) {
      for (let i = 0; i < centroid.length; i++) {
        centroid[i] += embedding[i];
      }
    }

    for (let i = 0; i < centroid.length; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  private generatePatternName(cluster: MeaningfulExtract[]): string {
    // Use most frequent keywords
    const keywordCounts = new Map<string, number>();
    for (const extract of cluster) {
      for (const keyword of extract.keywords) {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
      }
    }

    const topKeywords = Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);

    return topKeywords.join('_') || 'unnamed_pattern';
  }

  private generatePatternDescription(cluster: MeaningfulExtract[]): string {
    const categories = [...new Set(cluster.map(e => e.category))];
    return `Pattern from ${cluster.length} instances, categories: ${categories.join(', ')}`;
  }

  private calculatePatternConfidence(cluster: MeaningfulExtract[]): number {
    if (cluster.length < this.patternMinInstances) return 0;

    // Higher confidence with more instances and higher importance
    const avgImportance = cluster.reduce((sum, e) => sum + e.importance, 0) / cluster.length;
    const sizeBonus = Math.min(0.3, cluster.length / 20);

    return Math.min(1, avgImportance * 0.7 + sizeBonus);
  }

  private findSimilarProcess(
    taskType: string,
    steps: ProcessStep[]
  ): LearnedProcess | null {
    for (const process of this.processes.values()) {
      if (process.taskType !== taskType) continue;

      // Compare step structure
      if (Math.abs(process.steps.length - steps.length) <= 2) {
        const actionMatch = this.compareStepActions(process.steps, steps);
        if (actionMatch > 0.7) {
          return process;
        }
      }
    }

    return null;
  }

  private compareStepActions(
    stepsA: ProcessStep[],
    stepsB: ProcessStep[]
  ): number {
    const actionsA = new Set(stepsA.map(s => s.action.toLowerCase()));
    const actionsB = new Set(stepsB.map(s => s.action.toLowerCase()));

    const intersection = new Set([...actionsA].filter(x => actionsB.has(x)));
    const union = new Set([...actionsA, ...actionsB]);

    return intersection.size / union.size;
  }

  private normalizeSteps(steps: ProcessStep[]): ProcessStep[] {
    return steps.map((step, index) => ({
      ...step,
      stepNumber: index + 1
    }));
  }

  private updateSuccessRate(process: LearnedProcess, success: boolean): number {
    const totalSuccess = process.successRate * process.totalExecutions + (success ? 1 : 0);
    return totalSuccess / (process.totalExecutions + 1);
  }

  private updateAverageDuration(process: LearnedProcess, duration: number): number {
    const totalDuration = process.averageDuration * process.totalExecutions + duration;
    return totalDuration / (process.totalExecutions + 1);
  }

  private async reinforceSuccessfulPath(
    inputId: UUID,
    outputId: UUID
  ): Promise<void> {
    // Strengthen connection between input and output
    const existingConnection = await this.graphManager.getConnection(inputId, outputId);

    if (existingConnection) {
      await this.graphManager.strengthenSynapse(existingConnection.id, 0.05);
    } else {
      // Create new connection
      await this.graphManager.connect(inputId, outputId, 'CAUSAL', 0.5, true);
    }
  }

  private inferTaskType(content: string): string {
    const lower = content.toLowerCase();

    if (/search|find|look|검색|찾/.test(lower)) return 'search';
    if (/create|make|build|생성|만들/.test(lower)) return 'create';
    if (/fix|debug|repair|수정|고치/.test(lower)) return 'fix';
    if (/explain|describe|설명/.test(lower)) return 'explain';
    if (/analyze|분석/.test(lower)) return 'analyze';

    return 'general';
  }

  private calculateSuccessRate(outcomes: OutcomeRecord[]): number {
    if (outcomes.length === 0) return 0;
    const successes = outcomes.filter(o => o.success).length;
    return successes / outcomes.length;
  }

  // ==================== Streaming Methods ====================

  /**
   * Stream a learning session with real-time progress updates
   *
   * Yields progress events as the learning progresses through all stages.
   *
   * @param inputNeuronId - Input neuron ID
   * @param inputContent - Input content to learn from
   * @param processSteps - Optional reasoning steps
   * @yields LearningProgressEvent for each stage
   *
   * @example
   * ```typescript
   * for await (const progress of learning.streamSession(neuronId, content)) {
   *   console.log(`${progress.stage}: ${progress.percentage.toFixed(0)}%`);
   * }
   * ```
   */
  async *streamSession(
    inputNeuronId: UUID,
    inputContent: string,
    processSteps?: ProcessStep[]
  ): AsyncGenerator<LearningProgressEvent> {
    // Start session
    const session = this.startSession();

    const createProgress = (
      stage: LearningStage,
      current: number,
      total: number,
      message?: string
    ): LearningProgressEvent => ({
      sessionId: session.id,
      stage,
      current,
      total,
      percentage: total > 0 ? (current / total) * 100 : 0,
      message,
    });

    try {
      // Stage 1: Extract
      yield createProgress('extract', 0, 100, 'Starting extraction...');

      const extracts = await this.extractMeaningful(inputNeuronId, inputContent);
      yield createProgress('extract', 100, 100, `Extracted ${extracts.length} meaningful segments`);

      // Stage 2: Patterns
      yield createProgress('patterns', 0, 100, 'Learning patterns...');

      const patterns = await this.learnPatterns(extracts.map(e => e.id));
      yield createProgress('patterns', 100, 100, `Discovered ${patterns.length} patterns`);

      // Stage 3: Process (if steps provided)
      if (processSteps && processSteps.length > 0) {
        yield createProgress('process', 0, 100, 'Learning process...');

        const process = await this.learnProcess(
          this.inferTaskType(inputContent),
          processSteps,
          patterns[0]?.id
        );
        yield createProgress('process', 100, 100, process ? 'Process learned' : 'Process skipped');
      }

      // Stage 4: Outcomes (recorded separately)
      yield createProgress('outcomes', 0, 100, 'Finalizing...');

      // End session
      await this.endSession();

      yield createProgress('outcomes', 100, 100, 'Session complete');

    } catch (error) {
      this.emit('error', {
        sessionId: session.id,
        error: error as Error,
      });
      throw error;
    }
  }

  /**
   * Get current session ID if any
   */
  getCurrentSessionId(): UUID | null {
    return this.currentSession?.id ?? null;
  }

  /**
   * Check if a session is active
   */
  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }

  // ==================== Auto-Persistence Methods ====================

  /**
   * Enable auto-persistence
   *
   * @param store - ProbabilisticStore to persist to
   * @param intervalMs - Interval between auto-saves (default: 60000 = 1 minute)
   *
   * @example
   * ```typescript
   * learning.enableAutoPersist(store, 30000); // Save every 30 seconds
   * ```
   */
  enableAutoPersist(store: ProbabilisticStore, intervalMs: number = 60000): void {
    this.autoPersistStore = store;
    this.autoPersistEnabled = true;

    // Clear existing interval if any
    if (this.autoPersistInterval) {
      clearInterval(this.autoPersistInterval);
    }

    // Start auto-persist interval (skips tick if previous persist still running)
    let persistInProgress = false;
    this.autoPersistInterval = setInterval(() => {
      if (persistInProgress) return;
      persistInProgress = true;
      this.persistNow()
        .catch(err => {
          this.emit('error', { error: err as Error });
        })
        .finally(() => {
          persistInProgress = false;
        });
    }, intervalMs);
  }

  /**
   * Disable auto-persistence
   */
  disableAutoPersist(): void {
    this.autoPersistEnabled = false;

    if (this.autoPersistInterval) {
      clearInterval(this.autoPersistInterval);
      this.autoPersistInterval = null;
    }
  }

  /**
   * Persist current state immediately
   */
  async persistNow(): Promise<void> {
    if (!this.autoPersistStore) {
      throw new Error('Auto-persist store not configured');
    }

    const data = this.serialize();
    await this.autoPersistStore.saveLearning(data);
  }

  /**
   * Load state from persistent store
   */
  async loadFromStore(store: ProbabilisticStore): Promise<boolean> {
    const data = await store.loadLearning();
    if (data) {
      this.load(data as any);
      return true;
    }
    return false;
  }

  // ==================== Persistence Methods ====================

  /**
   * Serialize learning system state for persistence.
   *
   * Converts all extracts, patterns, processes, outcomes, and
   * the current session to a JSON-serializable format.
   *
   * @returns Serialized state object for storage
   * @see {@link load} for restoring state
   */
  serialize(): object {
    return {
      extracts: Array.from(this.extracts.entries()).map(([id, extract]) => ({
        ...extract,
        embedding: Array.from(extract.embedding)
      })),
      patterns: Array.from(this.patterns.entries()).map(([id, pattern]) => ({
        ...pattern,
        centroid: Array.from(pattern.centroid)
      })),
      processes: Array.from(this.processes.entries()),
      outcomes: Array.from(this.outcomes.entries()),
      currentSession: this.currentSession ? {
        ...this.currentSession,
        stages: {
          extract: this.currentSession.stages.extract.map(e => ({
            ...e,
            embedding: Array.from(e.embedding)
          })),
          patterns: this.currentSession.stages.patterns.map(p => ({
            ...p,
            centroid: Array.from(p.centroid)
          })),
          processes: this.currentSession.stages.processes,
          outcomes: this.currentSession.stages.outcomes
        }
      } : null
    };
  }

  /**
   * Load learning system state from serialized data.
   *
   * Restores all extracts, patterns, processes, outcomes, and
   * session state. Embeddings/centroids are converted to Float32Array.
   *
   * @param data - Previously serialized learning system state
   * @see {@link serialize} for creating serialized state
   */
  load(data: {
    extracts?: Array<[string, any]>;
    patterns?: Array<[string, any]>;
    processes?: Array<[string, any]>;
    outcomes?: Array<[string, any]>;
    currentSession?: any;
  }): void {
    // Restore extracts with Float32Array embeddings
    this.extracts.clear();
    for (const extractData of data.extracts ?? []) {
      const item = extractData as any;
      const entry = Array.isArray(item) ? item : [item.id, item];
      const id = entry[0] as UUID;
      const extract = entry[1] as any;
      this.extracts.set(id, {
        ...extract,
        embedding: extract.embedding instanceof Float32Array
          ? extract.embedding
          : new Float32Array(extract.embedding)
      });
    }

    // Restore patterns with Float32Array centroids
    this.patterns.clear();
    for (const patternData of data.patterns ?? []) {
      const item = patternData as any;
      const entry = Array.isArray(item) ? item : [item.id, item];
      const id = entry[0] as UUID;
      const pattern = entry[1] as any;
      this.patterns.set(id, {
        ...pattern,
        centroid: pattern.centroid instanceof Float32Array
          ? pattern.centroid
          : new Float32Array(pattern.centroid)
      });
    }

    // Restore processes
    this.processes.clear();
    for (const processData of data.processes ?? []) {
      const item = processData as any;
      const entry = Array.isArray(item) ? item : [item.id, item];
      const id = entry[0] as UUID;
      const process = entry[1] as LearnedProcess;
      this.processes.set(id, process);
    }

    // Restore outcomes
    this.outcomes.clear();
    for (const outcomeData of data.outcomes ?? []) {
      const item = outcomeData as any;
      const entry = Array.isArray(item) ? item : [item.id, item];
      const id = entry[0] as UUID;
      const outcome = entry[1] as OutcomeRecord;
      this.outcomes.set(id, outcome);
    }

    // Restore current session if exists
    if (data.currentSession) {
      this.currentSession = {
        ...data.currentSession,
        stages: {
          extract: (data.currentSession.stages?.extract ?? []).map((e: any) => ({
            ...e,
            embedding: e.embedding instanceof Float32Array
              ? e.embedding
              : new Float32Array(e.embedding)
          })),
          patterns: (data.currentSession.stages?.patterns ?? []).map((p: any) => ({
            ...p,
            centroid: p.centroid instanceof Float32Array
              ? p.centroid
              : new Float32Array(p.centroid)
          })),
          processes: data.currentSession.stages?.processes ?? [],
          outcomes: data.currentSession.stages?.outcomes ?? []
        }
      };
    }
  }

  // ==================== Cleanup Methods ====================

  /**
   * Dispose of all resources held by the learning system.
   *
   * Call this when the learning system is no longer needed to:
   * - Stop auto-persistence intervals
   * - Remove all event listeners
   * - Clear all stored data
   *
   * After calling dispose(), the instance should not be used again.
   *
   * @example
   * ```typescript
   * const learning = new FourStageLearningSystem(options);
   * // ... use the learning system ...
   *
   * // Clean up when done
   * learning.dispose();
   * ```
   */
  dispose(): void {
    // Stop auto-persistence
    this.disableAutoPersist();
    this.autoPersistStore = null;

    // Remove all event listeners
    this.removeAllListeners();

    // Clear all data
    this.extracts.clear();
    this.patterns.clear();
    this.processes.clear();
    this.outcomes.clear();

    // End current session if any
    this.currentSession = null;
  }
}

/**
 * Create a FourStageLearningSystem instance
 */
export function createFourStageLearningSystem(
  options: FourStageLearningOptions
): FourStageLearningSystem {
  return new FourStageLearningSystem(options);
}
