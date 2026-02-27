/**
 * Future Attractor Model - Goal-Driven Probability Steering
 *
 * Based on Probabilistic Ontology Framework - Teleological Determinism:
 * - Future states act as "attractors" that influence present choices
 * - Current state probabilities are shaped by potential futures
 * - Goals create probability gradients that guide decision paths
 *
 * @module core/attractor-model
 */

import type { UUID, Embedding384, NeuronNode, INeuronStore } from '../types/index.js';
import { cosineSimilarity } from '../utils/similarity.js';

/**
 * Attractor state representing a future goal
 */
export interface Attractor {
  id: UUID;
  name: string;
  description: string;
  embedding: Embedding384;
  strength: number;           // How strongly it pulls (0-1)
  probability: number;        // Current probability of reaching (0-1)
  priority: number;           // User-defined priority (1-10)
  deadline?: string;          // Optional deadline
  prerequisites: UUID[];      // Required states before this can be reached
  createdAt: string;
  updatedAt: string;
  activations: number;        // How many times this attractor was used
}

/**
 * Probability field around an attractor
 */
export interface ProbabilityField {
  attractor: Attractor;
  gradient: Map<UUID, number>;  // neuronId -> probability influence
  reachableStates: UUID[];      // States that can reach this attractor
  pathProbabilities: PathProbability[];
}

/**
 * Probability of a path to attractor
 */
export interface PathProbability {
  path: UUID[];
  probability: number;
  estimatedSteps: number;
  bottlenecks: UUID[];
}

/**
 * Current state in the probability space
 */
export interface CurrentState {
  neuronId: UUID;
  embedding: Embedding384;
  timestamp: string;
  activeAttractors: UUID[];
  dominantAttractor?: UUID;
  transitionProbabilities: Map<UUID, number>;
}

/**
 * Transition between states
 */
export interface StateTransition {
  from: UUID;
  to: UUID;
  probability: number;
  attractorInfluence: Map<UUID, number>;  // How each attractor influenced this
  timestamp: string;
}

/**
 * A* search node
 */
interface AStarNode {
  id: UUID;
  parent: UUID | null;
  g: number;  // Cost from start to this node
  h: number;  // Heuristic estimate to goal
  f: number;  // Total cost estimate (g + h)
}

/**
 * Priority Queue for A* algorithm
 */
class PriorityQueue<T extends { f: number }> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  dequeue(): T | undefined {
    if (this.items.length === 0) return undefined;
    if (this.items.length === 1) return this.items.pop();

    const result = this.items[0];
    this.items[0] = this.items.pop()!;
    this.bubbleDown(0);
    return result;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  has(predicate: (item: T) => boolean): boolean {
    return this.items.some(predicate);
  }

  update(predicate: (item: T) => boolean, newItem: T): void {
    const index = this.items.findIndex(predicate);
    if (index >= 0) {
      this.items[index] = newItem;
      this.bubbleUp(index);
      this.bubbleDown(index);
    }
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.items[parentIndex].f <= this.items[index].f) break;
      [this.items[parentIndex], this.items[index]] = [this.items[index], this.items[parentIndex]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < this.items.length && this.items[left].f < this.items[smallest].f) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right].f < this.items[smallest].f) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
  }
}

/**
 * A* Search Result
 */
export interface AStarResult {
  found: boolean;
  path: UUID[];
  totalCost: number;
  nodesExplored: number;
  pathProbability: number;
  bottlenecks: { nodeId: UUID; costContribution: number }[];
}

/**
 * Attractor Model Options
 */
export interface AttractorModelOptions {
  neuronStore: INeuronStore;
  maxAttractors?: number;
  defaultStrength?: number;
  decayRate?: number;
  influenceRadius?: number;
  // A* algorithm options
  heuristicWeight?: number;    // Weight for heuristic (default: 1.0)
  maxSearchNodes?: number;      // Max nodes to explore (default: 1000)
}

/**
 * Attractor Model - Goal-Driven Probability Steering
 *
 * Implements teleological determinism where future goals (attractors)
 * influence present state probabilities through probability fields.
 *
 * Key Concepts:
 * - **Attractors**: Future goal states that "pull" the system towards them
 * - **Probability Fields**: Gradients that guide state transitions
 * - **Influence**: How strongly an attractor affects current decisions
 *
 * @example
 * ```typescript
 * const model = new AttractorModel({ neuronStore: store });
 *
 * // Create a goal attractor
 * const attractor = model.createAttractor(
 *   'goal-1',
 *   'Complete Project',
 *   'Finish all remaining tasks',
 *   goalEmbedding,
 *   { strength: 0.8, priority: 10 }
 * );
 *
 * // Calculate influence on current state
 * const influence = model.calculateInfluence(currentStateEmbedding);
 * console.log(`Goal influence: ${influence.get('goal-1')}`);
 *
 * // Find path to goal
 * const path = await model.findPathToAttractor('current-neuron', 'goal-1');
 * console.log(`Path probability: ${path?.probability}`);
 * ```
 *
 * @see {@link Attractor} for attractor state structure
 * @see {@link ProbabilityField} for field configuration
 */
export class AttractorModel {
  private store: INeuronStore;
  private maxAttractors: number;
  private defaultStrength: number;
  private decayRate: number;
  private influenceRadius: number;

  // A* algorithm options
  private heuristicWeight: number;
  private maxSearchNodes: number;

  // Attractor storage
  private attractors: Map<UUID, Attractor> = new Map();

  // Probability fields
  private fields: Map<UUID, ProbabilityField> = new Map();

  // State history
  private stateHistory: CurrentState[] = [];
  private transitions: StateTransition[] = [];

  // Current dominant attractor
  private dominantAttractor: UUID | null = null;

  // Caching for A* heuristics
  private embeddingCache: Map<UUID, Embedding384> = new Map();

  constructor(options: AttractorModelOptions) {
    this.store = options.neuronStore;
    this.maxAttractors = options.maxAttractors ?? 100;
    this.defaultStrength = options.defaultStrength ?? 0.5;
    this.decayRate = options.decayRate ?? 0.95;
    this.influenceRadius = options.influenceRadius ?? 0.7;
    this.heuristicWeight = options.heuristicWeight ?? 1.0;
    this.maxSearchNodes = options.maxSearchNodes ?? 1000;
  }

  /**
   * Create a new attractor (future goal state).
   *
   * Attractors represent desired future states that influence present
   * probability distributions. The strength and priority determine how
   * much pull the attractor has on state transitions.
   *
   * @param id - Unique identifier for the attractor
   * @param name - Human-readable name for the goal
   * @param description - Detailed description of the goal state
   * @param embedding - Semantic embedding representing the goal
   * @param options - Configuration options
   * @param options.strength - Pull strength (0-1), default: 0.5
   * @param options.probability - Initial probability of reaching (0-1), default: 0.5
   * @param options.priority - User-defined priority (1-10), default: 5
   * @param options.deadline - Optional ISO8601 deadline
   * @param options.prerequisites - IDs of required states before this
   * @returns The created Attractor object
   *
   * @example
   * ```typescript
   * const attractor = model.createAttractor(
   *   'learn-typescript',
   *   'Master TypeScript',
   *   'Become proficient in TypeScript development',
   *   tsEmbedding,
   *   { strength: 0.9, priority: 8, deadline: '2024-12-31' }
   * );
   * ```
   */
  createAttractor(
    id: UUID,
    name: string,
    description: string,
    embedding: Embedding384,
    options: Partial<Omit<Attractor, 'id' | 'name' | 'description' | 'embedding' | 'createdAt' | 'updatedAt' | 'activations'>> = {}
  ): Attractor {
    if (this.attractors.size >= this.maxAttractors) {
      // Remove least activated attractor
      this.pruneWeakestAttractor();
    }

    const attractor: Attractor = {
      id,
      name,
      description,
      embedding,
      strength: options.strength ?? this.defaultStrength,
      probability: options.probability ?? 0.5,
      priority: options.priority ?? 5,
      deadline: options.deadline,
      prerequisites: options.prerequisites ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activations: 0
    };

    this.attractors.set(id, attractor);
    this.updateProbabilityField(attractor);

    return attractor;
  }

  /**
   * Get attractor by ID
   */
  getAttractor(id: UUID): Attractor | undefined {
    return this.attractors.get(id);
  }

  /**
   * Update attractor properties
   */
  updateAttractor(id: UUID, updates: Partial<Attractor>): Attractor | null {
    const attractor = this.attractors.get(id);
    if (!attractor) return null;

    Object.assign(attractor, updates, { updatedAt: new Date().toISOString() });
    this.updateProbabilityField(attractor);

    return attractor;
  }

  /**
   * Calculate influence of all attractors on a given state.
   *
   * Influence is calculated using exponential decay based on semantic
   * distance, multiplied by attractor strength and priority.
   *
   * @param stateEmbedding - The current state's embedding vector
   * @returns Map of attractor IDs to their influence values (0-1)
   *
   * @example
   * ```typescript
   * const influences = model.calculateInfluence(currentEmbedding);
   * for (const [attractorId, influence] of influences) {
   *   if (influence > 0.5) {
   *     console.log(`Strong pull from ${attractorId}: ${influence}`);
   *   }
   * }
   * ```
   */
  calculateInfluence(stateEmbedding: Embedding384): Map<UUID, number> {
    const influences = new Map<UUID, number>();

    for (const [id, attractor] of this.attractors) {
      const similarity = cosineSimilarity(stateEmbedding, attractor.embedding);

      // Influence decreases with distance but increases with strength
      const distance = 1 - similarity;
      const influence = attractor.strength * Math.exp(-distance / this.influenceRadius);

      // Apply priority multiplier
      const priorityMultiplier = attractor.priority / 10;
      influences.set(id, influence * priorityMultiplier);
    }

    return influences;
  }

  /**
   * Get the dominant attractor for a state
   */
  getDominantAttractor(stateEmbedding: Embedding384): Attractor | null {
    const influences = this.calculateInfluence(stateEmbedding);

    let maxInfluence = 0;
    let dominant: Attractor | null = null;

    for (const [id, influence] of influences) {
      if (influence > maxInfluence) {
        maxInfluence = influence;
        dominant = this.attractors.get(id) ?? null;
      }
    }

    return dominant;
  }

  /**
   * Calculate transition probabilities from current state
   */
  async calculateTransitionProbabilities(
    currentNeuronId: UUID,
    candidateIds: UUID[]
  ): Promise<Map<UUID, number>> {
    const current = await this.store.getNeuron(currentNeuronId);
    if (!current) return new Map();

    const probabilities = new Map<UUID, number>();
    const currentInfluences = this.calculateInfluence(current.embedding);

    for (const candidateId of candidateIds) {
      const candidate = await this.store.getNeuron(candidateId);
      if (!candidate) continue;

      // Base probability from semantic similarity
      const baseSimilarity = cosineSimilarity(current.embedding, candidate.embedding);

      // Attractor boost: how much better is candidate for reaching attractors?
      let attractorBoost = 0;
      const candidateInfluences = this.calculateInfluence(candidate.embedding);

      for (const [attractorId, currentInf] of currentInfluences) {
        const candidateInf = candidateInfluences.get(attractorId) ?? 0;
        // Positive if candidate is closer to attractor
        attractorBoost += (candidateInf - currentInf);
      }

      // Normalize attractor boost
      attractorBoost = Math.tanh(attractorBoost);

      // Combined probability
      const probability = baseSimilarity * 0.4 + (0.5 + attractorBoost * 0.5) * 0.6;
      probabilities.set(candidateId, Math.max(0, Math.min(1, probability)));
    }

    // Normalize probabilities
    const total = Array.from(probabilities.values()).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const [id, prob] of probabilities) {
        probabilities.set(id, prob / total);
      }
    }

    return probabilities;
  }

  /**
   * Find optimal path from current state to an attractor using A* algorithm.
   *
   * A* guarantees the optimal path by combining:
   * - g(n): Actual cost from start to node n
   * - h(n): Heuristic estimate from n to goal (semantic distance)
   * - f(n) = g(n) + h(n): Total estimated cost
   *
   * The heuristic uses semantic distance (1 - cosine similarity) which is
   * admissible (never overestimates) for semantic spaces.
   *
   * @param currentNeuronId - Starting neuron ID
   * @param attractorId - Target attractor ID
   * @param maxDepth - Maximum search depth, default: 10
   * @returns Path information including probability and bottlenecks, or null if not found
   *
   * @example
   * ```typescript
   * const result = await model.findPathToAttractor('start', 'goal', 10);
   * if (result.found) {
   *   console.log(`Optimal path: ${result.path.join(' → ')}`);
   *   console.log(`Path probability: ${(result.pathProbability * 100).toFixed(1)}%`);
   *   console.log(`Nodes explored: ${result.nodesExplored}`);
   *   for (const bottleneck of result.bottlenecks) {
   *     console.log(`Bottleneck: ${bottleneck.nodeId} (cost: ${bottleneck.costContribution})`);
   *   }
   * }
   * ```
   */
  async findPathToAttractor(
    currentNeuronId: UUID,
    attractorId: UUID,
    maxDepth: number = 10
  ): Promise<PathProbability | null> {
    const attractor = this.attractors.get(attractorId);
    if (!attractor) return null;

    const result = await this.aStarSearch(currentNeuronId, attractor, maxDepth);

    if (!result.found) return null;

    return {
      path: result.path,
      probability: result.pathProbability,
      estimatedSteps: result.path.length - 1,
      bottlenecks: result.bottlenecks.map(b => b.nodeId)
    };
  }

  /**
   * A* Search Algorithm Implementation
   *
   * Uses:
   * - g(n) = sum of edge costs (1 - synapse.weight) from start
   * - h(n) = semantic distance (1 - cosine_similarity) to goal
   * - f(n) = g(n) + w * h(n) where w is heuristicWeight
   *
   * @param startId - Starting neuron ID
   * @param goal - Target attractor
   * @param maxDepth - Maximum path length
   * @returns A* search result with path, cost, and bottlenecks
   */
  async aStarSearch(
    startId: UUID,
    goal: Attractor,
    maxDepth: number = 10
  ): Promise<AStarResult> {
    // Initialize result
    const result: AStarResult = {
      found: false,
      path: [],
      totalCost: Infinity,
      nodesExplored: 0,
      pathProbability: 0,
      bottlenecks: []
    };

    // Get start node
    const startNode = await this.store.getNeuron(startId);
    if (!startNode) return result;

    // Cache start embedding
    this.embeddingCache.set(startId, startNode.embedding);

    // Calculate initial heuristic
    const startH = this.calculateHeuristic(startNode.embedding, goal.embedding);

    // Check if already at goal
    if (startH < 0.1) {
      result.found = true;
      result.path = [startId];
      result.totalCost = 0;
      result.pathProbability = 1;
      return result;
    }

    // Initialize open set (priority queue)
    const openSet = new PriorityQueue<AStarNode>();
    openSet.enqueue({
      id: startId,
      parent: null,
      g: 0,
      h: startH,
      f: this.heuristicWeight * startH
    });

    // Initialize closed set
    const closedSet = new Set<UUID>();

    // Track best g values
    const gScores = new Map<UUID, number>();
    gScores.set(startId, 0);

    // Track parent pointers for path reconstruction
    const cameFrom = new Map<UUID, UUID>();

    // Track edge costs for bottleneck analysis
    const edgeCosts = new Map<string, number>();

    // Track depth per node to avoid repeated path reconstruction
    const depthMap = new Map<UUID, number>();
    depthMap.set(startId, 0);

    // Main A* loop
    while (!openSet.isEmpty() && result.nodesExplored < this.maxSearchNodes) {
      const current = openSet.dequeue()!;
      result.nodesExplored++;

      // Skip if already processed
      if (closedSet.has(current.id)) continue;

      // Get current node embedding
      let currentEmbedding = this.embeddingCache.get(current.id);
      if (!currentEmbedding) {
        const node = await this.store.getNeuron(current.id);
        if (!node) continue;
        currentEmbedding = node.embedding;
        this.embeddingCache.set(current.id, currentEmbedding);
      }

      // Check if goal reached (similarity > 0.9)
      const similarity = cosineSimilarity(currentEmbedding, goal.embedding);
      if (similarity > 0.9) {
        result.found = true;
        result.totalCost = current.g;
        result.path = this.reconstructPath(current.id, cameFrom);
        result.pathProbability = this.calculatePathProbability(result.path, edgeCosts);
        result.bottlenecks = this.identifyAStarBottlenecks(result.path, edgeCosts);
        return result;
      }

      // Add to closed set
      closedSet.add(current.id);

      // Check depth limit using tracked depth
      const depth = depthMap.get(current.id) ?? 0;
      if (depth >= maxDepth) continue;

      // Expand neighbors
      const outgoing = await this.store.getOutgoingSynapses(current.id);

      for (const synapse of outgoing) {
        if (closedSet.has(synapse.targetId)) continue;

        // Get neighbor embedding
        let neighborEmbedding = this.embeddingCache.get(synapse.targetId);
        if (!neighborEmbedding) {
          const neighborNode = await this.store.getNeuron(synapse.targetId);
          if (!neighborNode) continue;
          neighborEmbedding = neighborNode.embedding;
          this.embeddingCache.set(synapse.targetId, neighborEmbedding);
        }

        // Calculate edge cost (lower weight = higher cost)
        // Cost = 1 - weight, so strong connections are cheap
        const edgeCost = 1 - synapse.weight;

        // Factor in attractor pull (moving towards attractor reduces cost)
        const currentToGoal = 1 - cosineSimilarity(currentEmbedding, goal.embedding);
        const neighborToGoal = 1 - cosineSimilarity(neighborEmbedding, goal.embedding);
        const attractorBonus = Math.max(0, currentToGoal - neighborToGoal) * 0.5;

        const adjustedCost = Math.max(0.01, edgeCost - attractorBonus);

        // Calculate tentative g score
        const tentativeG = current.g + adjustedCost;

        // Check if this path is better
        const existingG = gScores.get(synapse.targetId) ?? Infinity;
        if (tentativeG < existingG) {
          // Record this path
          cameFrom.set(synapse.targetId, current.id);
          gScores.set(synapse.targetId, tentativeG);
          edgeCosts.set(`${current.id}:${synapse.targetId}`, adjustedCost);
          depthMap.set(synapse.targetId, depth + 1);

          // Calculate heuristic
          const h = this.calculateHeuristic(neighborEmbedding, goal.embedding);
          const f = tentativeG + this.heuristicWeight * h;

          // Add to open set
          openSet.enqueue({
            id: synapse.targetId,
            parent: current.id,
            g: tentativeG,
            h,
            f
          });
        }
      }
    }

    return result;
  }

  /**
   * Calculate admissible heuristic for A* (semantic distance to goal)
   *
   * Uses 1 - cosine_similarity as distance metric.
   * Clamped to [0, 1] to ensure admissibility (never overestimates).
   *
   * Note: Raw cosine similarity ranges [-1, 1], so 1 - similarity can be up to 2.
   * Without clamping, this would violate A* admissibility when similarity < 0.
   */
  private calculateHeuristic(embedding: Embedding384, goalEmbedding: Embedding384): number {
    const similarity = cosineSimilarity(embedding, goalEmbedding);
    // Clamp to [0, 1] for admissibility: h(n) must never overestimate actual cost
    return Math.min(1, Math.max(0, 1 - similarity));
  }

  /**
   * Reconstruct path from A* search
   */
  private reconstructPath(goalId: UUID, cameFrom: Map<UUID, UUID>): UUID[] {
    const path: UUID[] = [goalId];
    let current = goalId;

    while (cameFrom.has(current)) {
      current = cameFrom.get(current)!;
      path.unshift(current);
    }

    return path;
  }

  /**
   * Calculate path probability (product of edge weights)
   */
  private calculatePathProbability(path: UUID[], edgeCosts: Map<string, number>): number {
    if (path.length < 2) return 1;

    let probability = 1;
    for (let i = 0; i < path.length - 1; i++) {
      const edgeKey = `${path[i]}:${path[i + 1]}`;
      const cost = edgeCosts.get(edgeKey) ?? 0.5;
      // Convert cost back to probability-like value
      // cost = 1 - weight, so weight = 1 - cost
      probability *= (1 - cost);
    }

    return probability;
  }

  /**
   * Identify bottlenecks from A* search (high-cost edges)
   */
  private identifyAStarBottlenecks(
    path: UUID[],
    edgeCosts: Map<string, number>
  ): { nodeId: UUID; costContribution: number }[] {
    const bottlenecks: { nodeId: UUID; costContribution: number }[] = [];

    // Calculate average edge cost
    let totalCost = 0;
    let edgeCount = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const edgeKey = `${path[i]}:${path[i + 1]}`;
      const cost = edgeCosts.get(edgeKey) ?? 0;
      totalCost += cost;
      edgeCount++;
    }

    const avgCost = edgeCount > 0 ? totalCost / edgeCount : 0;

    // Bottlenecks are edges with above-average cost
    for (let i = 0; i < path.length - 1; i++) {
      const edgeKey = `${path[i]}:${path[i + 1]}`;
      const cost = edgeCosts.get(edgeKey) ?? 0;

      if (cost > avgCost * 1.5) {
        bottlenecks.push({
          nodeId: path[i + 1],
          costContribution: cost
        });
      }
    }

    // Sort by cost contribution (highest first)
    bottlenecks.sort((a, b) => b.costContribution - a.costContribution);

    return bottlenecks;
  }

  /**
   * Find multiple alternative paths to attractor
   *
   * Uses A* with path exclusion to find k-best paths
   */
  async findAlternativePaths(
    currentNeuronId: UUID,
    attractorId: UUID,
    k: number = 3,
    maxDepth: number = 10
  ): Promise<AStarResult[]> {
    const attractor = this.attractors.get(attractorId);
    if (!attractor) return [];

    const results: AStarResult[] = [];
    const usedPaths = new Set<string>();

    for (let i = 0; i < k; i++) {
      const result = await this.aStarSearchWithExclusion(
        currentNeuronId,
        attractor,
        maxDepth,
        usedPaths
      );

      if (!result.found) break;

      results.push(result);
      usedPaths.add(result.path.join(':'));
    }

    return results;
  }

  /**
   * A* search with path exclusion for k-best paths (Yen's algorithm variant)
   *
   * Penalizes edges used by excluded paths to force exploration of alternatives.
   */
  private async aStarSearchWithExclusion(
    startId: UUID,
    goal: Attractor,
    maxDepth: number,
    excludedPaths: Set<string>
  ): Promise<AStarResult> {
    // Build a set of excluded edges from previously found paths
    const excludedEdges = new Set<string>();
    for (const pathKey of excludedPaths) {
      const nodes = pathKey.split(':');
      for (let i = 0; i < nodes.length - 1; i++) {
        excludedEdges.add(`${nodes[i]}:${nodes[i + 1]}`);
      }
    }

    // Run A* with edge penalties
    const result: AStarResult = {
      found: false, path: [], totalCost: Infinity,
      nodesExplored: 0, pathProbability: 0, bottlenecks: []
    };

    const startEmbedding = this.embeddingCache.get(startId)
      ?? (await this.store.getNeuron(startId))?.embedding;
    if (!startEmbedding) return result;
    this.embeddingCache.set(startId, startEmbedding);

    const startH = this.calculateHeuristic(startEmbedding, goal.embedding);
    const openSet = new PriorityQueue<AStarNode>();
    openSet.enqueue({ id: startId, parent: null, g: 0, h: startH, f: this.heuristicWeight * startH });

    const closedSet = new Set<UUID>();
    const gScores = new Map<UUID, number>();
    gScores.set(startId, 0);
    const cameFrom = new Map<UUID, UUID>();
    const edgeCosts = new Map<string, number>();

    while (!openSet.isEmpty() && result.nodesExplored < this.maxSearchNodes) {
      const current = openSet.dequeue()!;
      result.nodesExplored++;

      if (closedSet.has(current.id)) continue;

      let currentEmbedding = this.embeddingCache.get(current.id);
      if (!currentEmbedding) {
        const node = await this.store.getNeuron(current.id);
        if (!node) continue;
        currentEmbedding = node.embedding;
        this.embeddingCache.set(current.id, currentEmbedding);
      }

      const similarity = cosineSimilarity(currentEmbedding, goal.embedding);
      if (similarity > 0.9) {
        const candidatePath = this.reconstructPath(current.id, cameFrom);
        const candidateKey = candidatePath.join(':');
        // Reject if this exact path was already found
        if (!excludedPaths.has(candidateKey)) {
          result.found = true;
          result.totalCost = current.g;
          result.path = candidatePath;
          result.pathProbability = this.calculatePathProbability(result.path, edgeCosts);
          result.bottlenecks = this.identifyAStarBottlenecks(result.path, edgeCosts);
          return result;
        }
      }

      closedSet.add(current.id);

      const depth = this.reconstructPath(current.id, cameFrom).length - 1;
      if (depth >= maxDepth) continue;

      const outgoing = await this.store.getOutgoingSynapses(current.id);
      for (const synapse of outgoing) {
        if (closedSet.has(synapse.targetId)) continue;

        let neighborEmbedding = this.embeddingCache.get(synapse.targetId);
        if (!neighborEmbedding) {
          const neighborNode = await this.store.getNeuron(synapse.targetId);
          if (!neighborNode) continue;
          neighborEmbedding = neighborNode.embedding;
          this.embeddingCache.set(synapse.targetId, neighborEmbedding);
        }

        let edgeCost = 1 - synapse.weight;
        const currentToGoal = 1 - cosineSimilarity(currentEmbedding, goal.embedding);
        const neighborToGoal = 1 - cosineSimilarity(neighborEmbedding, goal.embedding);
        const attractorBonus = Math.max(0, currentToGoal - neighborToGoal) * 0.5;
        edgeCost = Math.max(0.01, edgeCost - attractorBonus);

        // Penalize excluded edges to force alternative paths
        const edgeKey = `${current.id}:${synapse.targetId}`;
        if (excludedEdges.has(edgeKey)) {
          edgeCost += 2.0;
        }

        const tentativeG = current.g + edgeCost;
        const existingG = gScores.get(synapse.targetId) ?? Infinity;
        if (tentativeG < existingG) {
          cameFrom.set(synapse.targetId, current.id);
          gScores.set(synapse.targetId, tentativeG);
          edgeCosts.set(edgeKey, edgeCost);
          const h = this.calculateHeuristic(neighborEmbedding, goal.embedding);
          openSet.enqueue({ id: synapse.targetId, parent: current.id, g: tentativeG, h, f: tentativeG + this.heuristicWeight * h });
        }
      }
    }

    return result;
  }

  /**
   * Bidirectional A* search for faster pathfinding
   *
   * Runs forward A* from start and backward BFS from the goal's nearest neurons,
   * meeting in the middle for faster convergence on large graphs.
   * Falls back to standard A* when no backward anchors can be identified.
   */
  async bidirectionalAStarSearch(
    startId: UUID,
    attractorId: UUID,
    maxDepth: number = 10
  ): Promise<AStarResult> {
    const attractor = this.attractors.get(attractorId);
    if (!attractor) {
      return { found: false, path: [], totalCost: Infinity, nodesExplored: 0, pathProbability: 0, bottlenecks: [] };
    }

    // Identify goal-side anchor nodes: neurons highly similar to the attractor
    const allNeuronIds = await this.store.getAllNeuronIds();
    const goalAnchors: { id: UUID; similarity: number }[] = [];

    for (const nid of allNeuronIds) {
      let emb = this.embeddingCache.get(nid);
      if (!emb) {
        const n = await this.store.getNeuron(nid);
        if (!n) continue;
        emb = n.embedding;
        this.embeddingCache.set(nid, emb);
      }
      const sim = cosineSimilarity(emb, attractor.embedding);
      if (sim > 0.85) {
        goalAnchors.push({ id: nid, similarity: sim });
      }
    }

    // No anchors near the goal -- fall back to standard A*
    if (goalAnchors.length === 0) {
      return this.aStarSearch(startId, attractor, maxDepth);
    }

    // Build backward reachability from goal anchors (BFS up to maxDepth/2)
    const backwardReach = new Map<UUID, UUID[]>(); // nodeId -> path to goal anchor
    const backwardDepth = Math.max(2, Math.floor(maxDepth / 2));

    for (const anchor of goalAnchors) {
      const queue: { id: UUID; path: UUID[] }[] = [{ id: anchor.id, path: [anchor.id] }];
      const visited = new Set<UUID>([anchor.id]);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.path.length > backwardDepth) continue;

        const incoming = await this.store.getIncomingSynapses(current.id);
        for (const syn of incoming) {
          if (visited.has(syn.sourceId)) continue;
          visited.add(syn.sourceId);
          const path = [syn.sourceId, ...current.path];
          // Keep shortest path per node
          if (!backwardReach.has(syn.sourceId) || backwardReach.get(syn.sourceId)!.length > path.length) {
            backwardReach.set(syn.sourceId, path);
          }
          queue.push({ id: syn.sourceId, path });
        }
      }
    }

    // Forward A* from start, checking for meeting points with backward reach
    const result: AStarResult = {
      found: false, path: [], totalCost: Infinity,
      nodesExplored: 0, pathProbability: 0, bottlenecks: []
    };

    const startNode = await this.store.getNeuron(startId);
    if (!startNode) return this.aStarSearch(startId, attractor, maxDepth);
    this.embeddingCache.set(startId, startNode.embedding);

    const startH = this.calculateHeuristic(startNode.embedding, attractor.embedding);
    const openSet = new PriorityQueue<AStarNode>();
    openSet.enqueue({ id: startId, parent: null, g: 0, h: startH, f: this.heuristicWeight * startH });

    const closedSet = new Set<UUID>();
    const gScores = new Map<UUID, number>();
    gScores.set(startId, 0);
    const cameFrom = new Map<UUID, UUID>();
    const edgeCosts = new Map<string, number>();

    while (!openSet.isEmpty() && result.nodesExplored < this.maxSearchNodes) {
      const current = openSet.dequeue()!;
      result.nodesExplored++;

      if (closedSet.has(current.id)) continue;

      // Check if current node is a meeting point with backward reach
      if (backwardReach.has(current.id)) {
        const forwardPath = this.reconstructPath(current.id, cameFrom);
        const backwardPath = backwardReach.get(current.id)!;
        // Stitch: forward path + backward path (skip duplicate meeting node)
        result.found = true;
        result.path = [...forwardPath, ...backwardPath.slice(1)];
        result.totalCost = current.g;
        result.pathProbability = this.calculatePathProbability(result.path, edgeCosts);
        result.bottlenecks = this.identifyAStarBottlenecks(result.path, edgeCosts);
        return result;
      }

      // Standard A* goal check (similarity > 0.9)
      let currentEmbedding = this.embeddingCache.get(current.id);
      if (!currentEmbedding) {
        const node = await this.store.getNeuron(current.id);
        if (!node) continue;
        currentEmbedding = node.embedding;
        this.embeddingCache.set(current.id, currentEmbedding);
      }

      const similarity = cosineSimilarity(currentEmbedding, attractor.embedding);
      if (similarity > 0.9) {
        result.found = true;
        result.totalCost = current.g;
        result.path = this.reconstructPath(current.id, cameFrom);
        result.pathProbability = this.calculatePathProbability(result.path, edgeCosts);
        result.bottlenecks = this.identifyAStarBottlenecks(result.path, edgeCosts);
        return result;
      }

      closedSet.add(current.id);

      const depth = this.reconstructPath(current.id, cameFrom).length - 1;
      if (depth >= maxDepth) continue;

      const outgoing = await this.store.getOutgoingSynapses(current.id);
      for (const synapse of outgoing) {
        if (closedSet.has(synapse.targetId)) continue;

        let neighborEmbedding = this.embeddingCache.get(synapse.targetId);
        if (!neighborEmbedding) {
          const neighborNode = await this.store.getNeuron(synapse.targetId);
          if (!neighborNode) continue;
          neighborEmbedding = neighborNode.embedding;
          this.embeddingCache.set(synapse.targetId, neighborEmbedding);
        }

        const edgeCost = 1 - synapse.weight;
        const currentToGoal = 1 - cosineSimilarity(currentEmbedding, attractor.embedding);
        const neighborToGoal = 1 - cosineSimilarity(neighborEmbedding, attractor.embedding);
        const attractorBonus = Math.max(0, currentToGoal - neighborToGoal) * 0.5;
        const adjustedCost = Math.max(0.01, edgeCost - attractorBonus);

        const tentativeG = current.g + adjustedCost;
        const existingG = gScores.get(synapse.targetId) ?? Infinity;
        if (tentativeG < existingG) {
          cameFrom.set(synapse.targetId, current.id);
          gScores.set(synapse.targetId, tentativeG);
          edgeCosts.set(`${current.id}:${synapse.targetId}`, adjustedCost);
          const h = this.calculateHeuristic(neighborEmbedding, attractor.embedding);
          openSet.enqueue({ id: synapse.targetId, parent: current.id, g: tentativeG, h, f: tentativeG + this.heuristicWeight * h });
        }
      }
    }

    return result;
  }

  /**
   * Clear embedding cache to free memory
   */
  clearCache(): void {
    this.embeddingCache.clear();
  }

  /**
   * Record a state transition between neurons.
   *
   * Tracks how state transitions are influenced by attractors,
   * updating attractor activation counts when transitions move
   * towards them.
   *
   * @param fromId - Source neuron ID
   * @param toId - Target neuron ID
   * @returns The recorded transition with attractor influences
   * @throws Error if either neuron ID is invalid
   */
  async recordTransition(
    fromId: UUID,
    toId: UUID
  ): Promise<StateTransition> {
    const from = await this.store.getNeuron(fromId);
    const to = await this.store.getNeuron(toId);

    if (!from || !to) {
      throw new Error('Invalid neuron IDs for transition');
    }

    // Calculate probability based on attractor influences
    const fromInfluences = this.calculateInfluence(from.embedding);
    const toInfluences = this.calculateInfluence(to.embedding);

    let probability = cosineSimilarity(from.embedding, to.embedding);

    // Track attractor contribution
    const attractorInfluence = new Map<UUID, number>();
    for (const [attractorId, fromInf] of fromInfluences) {
      const toInf = toInfluences.get(attractorId) ?? 0;
      const contribution = toInf - fromInf;
      attractorInfluence.set(attractorId, contribution);

      // If moving towards an attractor, increase that attractor's activation
      if (contribution > 0) {
        const attractor = this.attractors.get(attractorId);
        if (attractor) {
          attractor.activations++;
        }
      }
    }

    const transition: StateTransition = {
      from: fromId,
      to: toId,
      probability,
      attractorInfluence,
      timestamp: new Date().toISOString()
    };

    this.transitions.push(transition);

    // Update state history
    this.stateHistory.push({
      neuronId: toId,
      embedding: to.embedding,
      timestamp: transition.timestamp,
      activeAttractors: Array.from(attractorInfluence.keys()).filter(
        id => (attractorInfluence.get(id) ?? 0) > 0
      ),
      dominantAttractor: this.getDominantAttractor(to.embedding)?.id,
      transitionProbabilities: new Map()
    });

    return transition;
  }

  /**
   * Update attractor probabilities based on current state
   */
  async updateAttractorProbabilities(currentNeuronId: UUID): Promise<void> {
    const current = await this.store.getNeuron(currentNeuronId);
    if (!current) return;

    for (const [id, attractor] of this.attractors) {
      const similarity = cosineSimilarity(current.embedding, attractor.embedding);

      // Update probability with exponential smoothing
      const newProb = 0.8 * attractor.probability + 0.2 * similarity;
      attractor.probability = Math.max(0, Math.min(1, newProb));
      attractor.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Decay attractor strengths over time.
   *
   * Applies exponential decay to attractors that haven't been
   * updated in 24+ hours. Very weak attractors with few activations
   * are automatically removed.
   *
   * Call this periodically (e.g., hourly) to maintain attractor health.
   */
  decayAttractors(): void {
    const now = Date.now();

    for (const attractor of this.attractors.values()) {
      const lastUpdated = new Date(attractor.updatedAt).getTime();
      const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);

      if (hoursSinceUpdate > 24) {
        // Apply decay
        attractor.strength *= this.decayRate;

        // Remove very weak attractors
        if (attractor.strength < 0.01 && attractor.activations < 5) {
          this.attractors.delete(attractor.id);
          this.fields.delete(attractor.id);
        }
      }
    }
  }

  /**
   * Get all active attractors
   */
  getActiveAttractors(): Attractor[] {
    return Array.from(this.attractors.values())
      .filter(a => a.strength > 0.1)
      .sort((a, b) => b.priority * b.strength - a.priority * a.strength);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalAttractors: number;
    activeAttractors: number;
    transitions: number;
    stateHistory: number;
    averageStrength: number;
    averageActivations: number;
  } {
    let totalStrength = 0;
    let totalActivations = 0;
    let activeCount = 0;

    for (const attractor of this.attractors.values()) {
      totalStrength += attractor.strength;
      totalActivations += attractor.activations;
      if (attractor.strength > 0.1) activeCount++;
    }

    return {
      totalAttractors: this.attractors.size,
      activeAttractors: activeCount,
      transitions: this.transitions.length,
      stateHistory: this.stateHistory.length,
      averageStrength: this.attractors.size > 0 ? totalStrength / this.attractors.size : 0,
      averageActivations: this.attractors.size > 0 ? totalActivations / this.attractors.size : 0
    };
  }

  /**
   * Serialize attractor model state for persistence.
   *
   * Converts all attractors, transitions, and state to a JSON-serializable
   * object. Embeddings are converted to plain arrays.
   *
   * @returns Serialized state object for storage
   * @see {@link load} for restoring state
   */
  serialize(): object {
    return {
      attractors: Array.from(this.attractors.entries()).map(([id, a]) => ({
        ...a,
        embedding: Array.from(a.embedding)
      })),
      transitions: this.transitions.slice(-1000),  // Keep last 1000 transitions
      dominantAttractor: this.dominantAttractor
    };
  }

  /**
   * Load attractor model from serialized data.
   *
   * Restores all attractors, transitions, and state from previously
   * serialized data. Embeddings are converted back to Float32Array.
   *
   * @param data - Previously serialized attractor model state
   * @see {@link serialize} for creating serialized state
   */
  load(data: any): void {
    this.attractors.clear();

    for (const a of data.attractors ?? []) {
      const attractor: Attractor = {
        ...a,
        embedding: new Float32Array(a.embedding)
      };
      this.attractors.set(a.id, attractor);
      this.updateProbabilityField(attractor);
    }

    this.transitions = data.transitions ?? [];
    this.dominantAttractor = data.dominantAttractor ?? null;
  }

  // ==================== Private Methods ====================

  private updateProbabilityField(attractor: Attractor): void {
    const gradient = new Map<UUID, number>();
    const reachableStates: UUID[] = [];
    const pathProbabilities: PathProbability[] = [];

    // Compute gradient: similarity-based influence for cached embeddings
    for (const [neuronId, embedding] of this.embeddingCache.entries()) {
      const similarity = cosineSimilarity(embedding, attractor.embedding);
      const influence = similarity * attractor.strength;
      if (influence > 0.05) {
        gradient.set(neuronId, influence);
        reachableStates.push(neuronId);
      }
    }

    // Compute path probabilities from recorded transitions
    for (const transition of this.transitions) {
      if (transition.attractorInfluence) {
        const influence = transition.attractorInfluence.get(attractor.id);
        if (influence && influence > 0.1) {
          pathProbabilities.push({
            path: [transition.from, transition.to],
            probability: influence,
            estimatedSteps: 1,
            bottlenecks: [],
          });
        }
      }
    }

    const field: ProbabilityField = {
      attractor,
      gradient,
      reachableStates,
      pathProbabilities,
    };

    this.fields.set(attractor.id, field);
  }

  private pruneWeakestAttractor(): void {
    let weakest: Attractor | null = null;
    let weakestScore = Infinity;

    for (const attractor of this.attractors.values()) {
      const score = attractor.strength * attractor.priority * (1 + attractor.activations / 100);
      if (score < weakestScore) {
        weakestScore = score;
        weakest = attractor;
      }
    }

    if (weakest) {
      this.attractors.delete(weakest.id);
      this.fields.delete(weakest.id);
    }
  }

  /**
   * Simple bottleneck identification for legacy compatibility
   * @deprecated Use identifyAStarBottlenecks for accurate bottleneck detection
   */
  private identifyBottlenecks(path: UUID[]): UUID[] {
    // Bottlenecks are nodes where probability drops significantly
    // For now, return middle nodes as potential bottlenecks
    if (path.length <= 2) return [];
    return path.slice(1, -1);
  }

  /**
   * Get path cost breakdown
   */
  async analyzePathCost(path: UUID[]): Promise<{
    totalCost: number;
    edgeCosts: { from: UUID; to: UUID; cost: number }[];
    avgCost: number;
  }> {
    const edgeCosts: { from: UUID; to: UUID; cost: number }[] = [];
    let totalCost = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const synapses = await this.store.getOutgoingSynapses(path[i]);
      const synapse = synapses.find(s => s.targetId === path[i + 1]);
      const cost = synapse ? 1 - synapse.weight : 0.5;

      edgeCosts.push({ from: path[i], to: path[i + 1], cost });
      totalCost += cost;
    }

    return {
      totalCost,
      edgeCosts,
      avgCost: edgeCosts.length > 0 ? totalCost / edgeCosts.length : 0
    };
  }
}

/**
 * Create an AttractorModel instance
 */
export function createAttractorModel(options: AttractorModelOptions): AttractorModel {
  return new AttractorModel(options);
}
