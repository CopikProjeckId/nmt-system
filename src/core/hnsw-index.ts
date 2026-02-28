/**
 * HNSW Index - Hierarchical Navigable Small World Graph
 * @module core/hnsw-index
 */

import type {
  UUID,
  Embedding384,
  HNSWParams,
  HNSWNode,
  HNSWLayer,
  HNSWIndexData,
  SearchResult,
  DEFAULT_CONFIG
} from '../types/index.js';
import { cosineSimilarity } from '../utils/similarity.js';
import { generateUUID } from '../utils/uuid.js';

/**
 * Default HNSW parameters
 */
const DEFAULT_HNSW_PARAMS: HNSWParams = {
  M: 16,
  efConstruction: 200,
  efSearch: 50,
  mL: 1 / Math.log(16)
};

/**
 * HNSW Index implementation for approximate nearest neighbor search
 */
export class HNSWIndex {
  private params: HNSWParams;
  private layers: Map<number, HNSWLayer>;
  private nodes: Map<UUID, HNSWNode>;
  private entryPoint: UUID | null;
  private maxLayer: number;
  private tombstones: Set<UUID> = new Set();
  private entryPointStale = false;

  constructor(params: Partial<HNSWParams> = {}) {
    this.params = {
      M: params.M ?? DEFAULT_HNSW_PARAMS.M,
      efConstruction: params.efConstruction ?? DEFAULT_HNSW_PARAMS.efConstruction,
      efSearch: params.efSearch ?? DEFAULT_HNSW_PARAMS.efSearch,
      mL: params.mL ?? 1 / Math.log(params.M ?? DEFAULT_HNSW_PARAMS.M)
    };

    this.layers = new Map();
    this.nodes = new Map();
    this.entryPoint = null;
    this.maxLayer = -1;
  }

  /**
   * Get the number of live (non-tombstoned) nodes in the index
   */
  get size(): number {
    return this.nodes.size - this.tombstones.size;
  }

  /**
   * Insert a new node into the index
   * @param id - Node identifier
   * @param embedding - 384-dimensional embedding vector
   */
  insert(id: UUID, embedding: Embedding384): void {
    // Check if node already exists
    if (this.nodes.has(id)) {
      throw new Error(`Node ${id} already exists in index`);
    }

    // Assign layer using exponential distribution
    const nodeLayer = this.assignLayer();

    // Create new node
    const node: HNSWNode = {
      id,
      embedding,
      layer: nodeLayer,
      connections: new Map()
    };

    // Initialize connections for each layer
    for (let l = 0; l <= nodeLayer; l++) {
      node.connections.set(l, new Set());
    }

    this.nodes.set(id, node);

    // Handle first node insertion
    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLayer = nodeLayer;
      this.ensureLayer(nodeLayer);
      this.getLayer(nodeLayer).nodes.add(id);
      return;
    }

    // Start from entry point and navigate down to layer 0
    let currentNode = this.entryPoint;
    const entryNode = this.nodes.get(currentNode)!;

    // Greedy search from top layer to nodeLayer + 1
    for (let l = this.maxLayer; l > nodeLayer; l--) {
      currentNode = this.greedySearch(currentNode, embedding, l);
    }

    // Insert and connect at each layer from nodeLayer down to 0
    for (let l = Math.min(nodeLayer, this.maxLayer); l >= 0; l--) {
      // Search for ef nearest neighbors at this layer
      const candidates = this.searchLayer(currentNode, embedding, this.params.efConstruction, l);

      // Select M best neighbors
      const neighbors = this.selectNeighbors(candidates, this.params.M);

      // Connect to neighbors (bidirectional)
      this.ensureLayer(l);
      const layer = this.getLayer(l);
      layer.nodes.add(id);

      for (const neighbor of neighbors) {
        // Add connection from new node to neighbor
        node.connections.get(l)!.add(neighbor.id);

        // Add connection from neighbor to new node
        const neighborNode = this.nodes.get(neighbor.id)!;
        if (!neighborNode.connections.has(l)) {
          neighborNode.connections.set(l, new Set());
        }
        neighborNode.connections.get(l)!.add(id);

        // Prune neighbor connections if necessary
        const maxConnections = l === 0 ? this.params.M * 2 : this.params.M;
        if (neighborNode.connections.get(l)!.size > maxConnections) {
          this.pruneConnections(neighbor.id, l, maxConnections);
        }
      }

      // Use closest neighbor as entry point for next layer
      if (candidates.length > 0) {
        currentNode = candidates[0].id;
      }
    }

    // Update entry point if new node has higher layer
    if (nodeLayer > this.maxLayer) {
      this.entryPoint = id;
      this.maxLayer = nodeLayer;
    }
  }

  /**
   * Search for k nearest neighbors
   * @param query - Query embedding
   * @param k - Number of neighbors to return
   * @param ef - Search expansion factor (default from params)
   * @returns Array of search results sorted by similarity
   */
  search(query: Embedding384, k: number, ef?: number): SearchResult[] {
    if (this.entryPoint === null) {
      return [];
    }

    // Lazy entry-point refresh after soft-deletes
    if (this.entryPointStale) {
      this.updateEntryPoint();
      this.entryPointStale = false;
    }

    if (this.entryPoint === null) {
      return [];
    }

    const efSearch = ef ?? this.params.efSearch;

    // Navigate from top layer to layer 1
    let currentNode = this.entryPoint;
    for (let l = this.maxLayer; l > 0; l--) {
      currentNode = this.greedySearch(currentNode, query, l);
    }

    // Search layer 0 with ef expansion
    const candidates = this.searchLayer(currentNode, query, Math.max(efSearch, k), 0);

    // Filter tombstoned nodes before returning
    return candidates.filter(r => !this.tombstones.has(r.id)).slice(0, k);
  }

  /**
   * Soft-delete a node — O(1), marks as tombstone.
   * The node is excluded from search results and `has()` checks immediately,
   * but its connections are not removed until `compact()` is called.
   * @param id - Node identifier to delete
   */
  delete(id: UUID): boolean {
    if (!this.nodes.has(id) || this.tombstones.has(id)) {
      return false;
    }
    this.tombstones.add(id);
    if (this.entryPoint === id) {
      this.entryPointStale = true;
    }
    return true;
  }

  /**
   * Immediately remove a node and clean up all its connections.
   * Used by `updateNeuronEmbedding` which needs the slot free for re-insert.
   * @param id - Node identifier to delete
   */
  forceDelete(id: UUID): boolean {
    // Remove from tombstone set if present
    this.tombstones.delete(id);

    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove bidirectional connections
    for (const [layer, conns] of node.connections) {
      for (const nbrId of conns) {
        this.nodes.get(nbrId)?.connections.get(layer)?.delete(id);
      }
      this.layers.get(layer)?.nodes.delete(id);
    }

    this.nodes.delete(id);

    if (this.entryPoint === id) {
      this.entryPoint = null;
      this.entryPointStale = true;
    }

    return true;
  }

  /**
   * Compact the index by physically removing all tombstoned nodes.
   * Should be called periodically in the background (e.g. after bulk deletes).
   * @returns Number of nodes actually removed
   */
  compact(): { removed: number } {
    let removed = 0;

    for (const id of this.tombstones) {
      const node = this.nodes.get(id);
      if (!node) {
        this.tombstones.delete(id);
        continue;
      }

      // Remove bidirectional connections
      for (const [layer, conns] of node.connections) {
        for (const nbrId of conns) {
          this.nodes.get(nbrId)?.connections.get(layer)?.delete(id);
        }
        this.layers.get(layer)?.nodes.delete(id);
      }

      this.nodes.delete(id);
      this.tombstones.delete(id);
      removed++;
    }

    if (removed > 0) {
      this.updateEntryPoint();
    }

    return { removed };
  }

  /** Number of soft-deleted nodes pending compaction */
  get tombstoneCount(): number {
    return this.tombstones.size;
  }

  /**
   * Check if a node exists in the index (excludes tombstoned nodes)
   * @param id - Node identifier
   */
  has(id: UUID): boolean {
    return this.nodes.has(id) && !this.tombstones.has(id);
  }

  /**
   * Get node by ID
   * @param id - Node identifier
   */
  getNode(id: UUID): HNSWNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all live (non-tombstoned) node IDs
   */
  getAllIds(): UUID[] {
    return Array.from(this.nodes.keys()).filter(id => !this.tombstones.has(id));
  }

  /**
   * Serialize the index to a JSON-friendly format
   */
  serialize(): HNSWIndexData {
    const layers: HNSWLayer[] = [];
    for (let l = 0; l <= this.maxLayer; l++) {
      const layer = this.layers.get(l);
      if (layer) {
        layers.push({
          level: l,
          nodes: layer.nodes
        });
      }
    }

    const serializedNodes: HNSWNode[] = [];
    for (const node of this.nodes.values()) {
      if (this.tombstones.has(node.id)) continue;
      const connections = new Map<number, Set<UUID>>();
      for (const [layer, conns] of node.connections) {
        connections.set(layer, new Set(conns));
      }
      serializedNodes.push({
        id: node.id,
        embedding: node.embedding,
        layer: node.layer,
        connections
      });
    }

    return {
      params: this.params,
      layers,
      entryPoint: this.entryPoint,
      nodes: serializedNodes
    };
  }

  /**
   * Deserialize index from JSON format
   */
  static deserialize(data: HNSWIndexData): HNSWIndex {
    const index = new HNSWIndex(data.params);

    // Restore nodes
    for (const nodeData of data.nodes) {
      const connections = new Map<number, Set<UUID>>();
      if (nodeData.connections instanceof Map) {
        for (const [layer, conns] of nodeData.connections) {
          connections.set(layer, new Set(conns));
        }
      } else {
        // Handle serialized format (object with arrays)
        const connObj = nodeData.connections as unknown as Record<string, string[]>;
        for (const [layer, conns] of Object.entries(connObj)) {
          connections.set(parseInt(layer), new Set(conns));
        }
      }

      const node: HNSWNode = {
        id: nodeData.id,
        embedding: nodeData.embedding instanceof Float32Array
          ? nodeData.embedding
          : new Float32Array(nodeData.embedding),
        layer: nodeData.layer,
        connections
      };
      index.nodes.set(node.id, node);
    }

    // Restore layers
    for (const layerData of data.layers) {
      index.layers.set(layerData.level, {
        level: layerData.level,
        nodes: new Set(layerData.nodes)
      });
    }

    // Restore entry point and max layer
    index.entryPoint = data.entryPoint;
    index.maxLayer = data.layers.length > 0
      ? Math.max(...data.layers.map((l: { level: number }) => l.level))
      : -1;

    return index;
  }

  /**
   * Assign layer for new node using exponential distribution
   */
  private assignLayer(): number {
    const r = Math.random();
    const layer = Math.floor(-Math.log(r) * this.params.mL);
    return layer;
  }

  /**
   * Greedy search to find closest node at a given layer
   */
  private greedySearch(entryId: UUID, query: Embedding384, layer: number): UUID {
    let currentId = entryId;
    let currentNode = this.nodes.get(currentId)!;
    let currentSim = this.similarity(query, currentNode.embedding);

    let improved = true;
    while (improved) {
      improved = false;
      const connections = currentNode.connections.get(layer);
      if (!connections) break;

      for (const neighborId of connections) {
        if (this.tombstones.has(neighborId)) continue;
        const neighbor = this.nodes.get(neighborId);
        if (!neighbor) continue;

        const sim = this.similarity(query, neighbor.embedding);
        if (sim > currentSim) {
          currentId = neighborId;
          currentNode = neighbor;
          currentSim = sim;
          improved = true;
        }
      }
    }

    return currentId;
  }

  /**
   * Search a layer for candidates using beam search
   */
  private searchLayer(
    entryId: UUID,
    query: Embedding384,
    ef: number,
    layer: number
  ): SearchResult[] {
    const visited = new Set<UUID>();
    const candidates: SearchResult[] = [];
    const results: SearchResult[] = [];

    // Initialize with entry point
    const entryNode = this.nodes.get(entryId)!;
    const entrySim = this.similarity(query, entryNode.embedding);

    candidates.push({ id: entryId, score: entrySim, distance: 1 - entrySim });
    results.push({ id: entryId, score: entrySim, distance: 1 - entrySim });
    visited.add(entryId);

    // Helper: insert into sorted array (descending by score) using binary search
    const sortedInsert = (arr: SearchResult[], item: SearchResult) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].score > item.score) lo = mid + 1;
        else hi = mid;
      }
      arr.splice(lo, 0, item);
    };

    while (candidates.length > 0) {
      // Get candidate with highest similarity (first element, already sorted)
      const current = candidates.shift()!;

      // Check if worst result is better than current candidate
      if (results.length >= ef && current.score < results[results.length - 1].score) {
        break;
      }

      // Explore neighbors
      const currentNode = this.nodes.get(current.id);
      if (!currentNode) continue;

      const connections = currentNode.connections.get(layer);
      if (!connections) continue;

      for (const neighborId of connections) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        if (this.tombstones.has(neighborId)) continue;
        const neighbor = this.nodes.get(neighborId);
        if (!neighbor) continue;

        const sim = this.similarity(query, neighbor.embedding);
        const result: SearchResult = { id: neighborId, score: sim, distance: 1 - sim };

        // Add to candidates/results if better than worst result or not full
        if (results.length < ef || sim > results[results.length - 1].score) {
          sortedInsert(candidates, result);
          sortedInsert(results, result);

          // Keep only ef best results
          if (results.length > ef) {
            results.pop();
          }
        }
      }
    }

    return results;
  }

  /**
   * Select best neighbors from candidates
   */
  private selectNeighbors(candidates: SearchResult[], M: number): SearchResult[] {
    // Simple selection: take top M by similarity
    return candidates.slice(0, M);
  }

  /**
   * Prune connections to maintain max connections limit
   */
  private pruneConnections(nodeId: UUID, layer: number, maxConnections: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const connections = node.connections.get(layer);
    if (!connections || connections.size <= maxConnections) return;

    // Score all connections by similarity
    const scored: Array<{ id: UUID; sim: number }> = [];
    for (const connId of connections) {
      const connNode = this.nodes.get(connId);
      if (connNode) {
        scored.push({
          id: connId,
          sim: this.similarity(node.embedding, connNode.embedding)
        });
      }
    }

    // Sort by similarity and keep top maxConnections
    scored.sort((a, b) => b.sim - a.sim);
    const keepIds = new Set(scored.slice(0, maxConnections).map(s => s.id));

    // Update connections
    node.connections.set(layer, keepIds);
  }

  /**
   * Update entry point after deletion
   */
  private updateEntryPoint(): void {
    // Find live node with highest layer
    let maxLayer = -1;
    let newEntry: UUID | null = null;

    for (const node of this.nodes.values()) {
      if (this.tombstones.has(node.id)) continue;
      if (node.layer > maxLayer) {
        maxLayer = node.layer;
        newEntry = node.id;
      }
    }

    this.entryPoint = newEntry;
    this.maxLayer = maxLayer;
  }

  /**
   * Ensure layer exists
   */
  private ensureLayer(level: number): void {
    if (!this.layers.has(level)) {
      this.layers.set(level, { level, nodes: new Set() });
    }
  }

  /**
   * Get layer data
   */
  private getLayer(level: number): HNSWLayer {
    return this.layers.get(level)!;
  }

  /**
   * Compute similarity between two embeddings
   */
  private similarity(a: Embedding384, b: Embedding384): number {
    return cosineSimilarity(a, b);
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalNodes: number;
    layerDistribution: Map<number, number>;
    avgConnectionsPerLayer: Map<number, number>;
    maxLayer: number;
  } {
    const layerDistribution = new Map<number, number>();
    const connectionCounts = new Map<number, number[]>();

    for (const node of this.nodes.values()) {
      if (this.tombstones.has(node.id)) continue;

      // Count nodes per layer
      const count = layerDistribution.get(node.layer) ?? 0;
      layerDistribution.set(node.layer, count + 1);

      // Track connections per layer
      for (const [layer, connections] of node.connections) {
        if (!connectionCounts.has(layer)) {
          connectionCounts.set(layer, []);
        }
        connectionCounts.get(layer)!.push(connections.size);
      }
    }

    // Calculate average connections
    const avgConnectionsPerLayer = new Map<number, number>();
    for (const [layer, counts] of connectionCounts) {
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      avgConnectionsPerLayer.set(layer, Math.round(avg * 100) / 100);
    }

    return {
      totalNodes: this.nodes.size - this.tombstones.size,
      layerDistribution,
      avgConnectionsPerLayer,
      maxLayer: this.maxLayer
    };
  }
}

/**
 * Create an HNSWIndex instance with default parameters
 */
export function createHNSWIndex(params?: Partial<HNSWParams>): HNSWIndex {
  return new HNSWIndex(params);
}
