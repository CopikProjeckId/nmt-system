/**
 * E2E Performance Benchmark
 *
 * Measures production-readiness KPIs using in-memory mocks (no LevelDB / Xenova).
 * All tests run against pure algorithmic logic.
 *
 * Success criteria:
 *   - Ingest throughput  > 2 docs/sec
 *   - HNSW search p95    < 500 ms
 *   - Soft-delete per-op < 0.1 ms
 *   - Compact 100 nodes  < 5000 ms
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  UUID,
  Embedding384,
  NeuronNode,
  Synapse,
  SynapseType,
  Chunk,
  SHA3Hash,
  INeuronStore,
  IChunkStore,
} from '../../src/types/index.js';
import { HNSWIndex } from '../../src/core/hnsw-index.js';
import { NeuronGraphManager } from '../../src/core/neuron-graph.js';
import { ChunkEngine } from '../../src/core/chunk-engine.js';
import { MerkleEngine } from '../../src/core/merkle-engine.js';
import { IngestionService } from '../../src/services/ingestion.js';
import { DeterministicEmbeddingProvider } from '../../src/services/embedding-provider.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computePercentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedMs.length) - 1;
  return sortedMs[Math.max(0, idx)];
}

function createFixtures(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) =>
      `Document ${i}: The NMT system stores knowledge as neuron nodes connected by synapses. ` +
      `Each node has a 384-dim embedding and a Merkle-verified content hash. ` +
      `Unique seed value: ${i * 31337}`
  );
}

function makeEmbedding(seed: number): Embedding384 {
  const v = new Float32Array(384);
  let h = seed | 0;
  for (let i = 0; i < 384; i++) {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    v[i] = (h % 2000) / 2000 - 0.5;
  }
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < 384; i++) v[i] /= norm;
  return v;
}

let _uid = 0;
function uid(): UUID {
  return `mock-${++_uid}`;
}

// ─── In-memory INeuronStore ───────────────────────────────────────────────────

function createInMemoryNeuronStore(): INeuronStore {
  const neurons = new Map<UUID, NeuronNode>();
  const synapses = new Map<UUID, Synapse>();
  const byMerkle = new Map<string, UUID>();

  const now = () => new Date().toISOString();

  return {
    async init() {},
    async close() {},

    async createNeuron(input): Promise<NeuronNode> {
      const id = uid();
      const neuron: NeuronNode = {
        id,
        embedding: input.embedding,
        chunkHashes: input.chunkHashes,
        merkleRoot: input.merkleRoot,
        outgoingSynapses: [],
        incomingSynapses: [],
        metadata: {
          createdAt: now(),
          updatedAt: now(),
          accessCount: 0,
          lastAccessed: now(),
          sourceType: input.sourceType ?? 'text',
          tags: input.tags ?? [],
        },
      };
      neurons.set(id, neuron);
      byMerkle.set(input.merkleRoot, id);
      return neuron;
    },

    async putNeuron(neuron: NeuronNode): Promise<void> {
      neurons.set(neuron.id, neuron);
    },

    async getNeuron(id: UUID): Promise<NeuronNode | null> {
      return neurons.get(id) ?? null;
    },

    async getNeuronByMerkleRoot(merkleRoot: string): Promise<NeuronNode | null> {
      const id = byMerkle.get(merkleRoot);
      return id ? (neurons.get(id) ?? null) : null;
    },

    async updateNeuron(id: UUID, updates: Partial<NeuronNode>): Promise<NeuronNode | null> {
      const n = neurons.get(id);
      if (!n) return null;
      const updated = { ...n, ...updates, metadata: { ...n.metadata, ...(updates.metadata ?? {}), updatedAt: now() } };
      neurons.set(id, updated);
      return updated;
    },

    async deleteNeuron(id: UUID): Promise<boolean> {
      byMerkle.delete(neurons.get(id)?.merkleRoot ?? '');
      return neurons.delete(id);
    },

    async recordAccess(id: UUID): Promise<void> {
      const n = neurons.get(id);
      if (!n) return;
      n.metadata.accessCount++;
      n.metadata.lastAccessed = now();
    },

    async getAllNeuronIds(): Promise<UUID[]> {
      return Array.from(neurons.keys());
    },

    async getNeuronCount(): Promise<number> {
      return neurons.size;
    },

    async createSynapse(
      sourceId: UUID,
      targetId: UUID,
      type: SynapseType,
      weight = 0.5,
      bidirectional = false
    ): Promise<Synapse | null> {
      const id = uid();
      const synapse: Synapse = {
        id,
        sourceId,
        targetId,
        weight,
        type,
        metadata: {
          createdAt: now(),
          updatedAt: now(),
          activationCount: 0,
          lastActivated: now(),
          bidirectional: bidirectional ?? false,
        },
      };
      synapses.set(id, synapse);
      return synapse;
    },

    async putSynapse(synapse: Synapse): Promise<void> {
      synapses.set(synapse.id, synapse);
    },

    async getSynapse(id: UUID): Promise<Synapse | null> {
      return synapses.get(id) ?? null;
    },

    async getOutgoingSynapses(neuronId: UUID): Promise<Synapse[]> {
      return Array.from(synapses.values()).filter(s => s.sourceId === neuronId);
    },

    async getIncomingSynapses(neuronId: UUID): Promise<Synapse[]> {
      return Array.from(synapses.values()).filter(s => s.targetId === neuronId);
    },

    async updateSynapseWeight(id: UUID, weight: number): Promise<Synapse | null> {
      const s = synapses.get(id);
      if (!s) return null;
      s.weight = weight;
      s.metadata.updatedAt = now();
      return s;
    },

    async recordSynapseActivation(id: UUID): Promise<void> {
      const s = synapses.get(id);
      if (!s) return;
      s.metadata.activationCount++;
      s.metadata.lastActivated = now();
    },

    async deleteSynapse(id: UUID): Promise<boolean> {
      return synapses.delete(id);
    },

    async getSynapseCount(): Promise<number> {
      return synapses.size;
    },

    async findSimilar(embedding: Embedding384, k: number): Promise<NeuronNode[]> {
      return Array.from(neurons.values()).slice(0, k);
    },
  };
}

// ─── In-memory IChunkStore ────────────────────────────────────────────────────

function createInMemoryChunkStore(): IChunkStore {
  const store = new Map<SHA3Hash, Chunk>();

  return {
    async init() {},
    async close() {},

    async put(chunk: Chunk): Promise<SHA3Hash> {
      store.set(chunk.hash, chunk);
      return chunk.hash;
    },

    async putMany(chunks: Chunk[]): Promise<SHA3Hash[]> {
      return Promise.all(chunks.map(c => this.put(c)));
    },

    async get(hash: SHA3Hash): Promise<Chunk | null> {
      return store.get(hash) ?? null;
    },

    async getMany(hashes: SHA3Hash[]): Promise<(Chunk | null)[]> {
      return hashes.map(h => store.get(h) ?? null);
    },

    async has(hash: SHA3Hash): Promise<boolean> {
      return store.has(hash);
    },

    async delete(hash: SHA3Hash): Promise<boolean> {
      return store.delete(hash);
    },

    async getAllHashes(): Promise<SHA3Hash[]> {
      return Array.from(store.keys());
    },

    async getStats() {
      let totalSize = 0;
      for (const c of store.values()) totalSize += c.data.length;
      const totalChunks = store.size;
      return { totalChunks, totalSize, avgChunkSize: totalChunks ? totalSize / totalChunks : 0 };
    },

    async verifyIntegrity() {
      return { valid: store.size, corrupted: [], missing: [] };
    },

    async gc(): Promise<number> {
      return 0;
    },
  };
}

// ─── Test setup factory ───────────────────────────────────────────────────────

function createTestSystem() {
  const neuronStore = createInMemoryNeuronStore();
  const chunkStore = createInMemoryChunkStore();
  const index = new HNSWIndex({ M: 16, efConstruction: 200, efSearch: 50 });
  const graphManager = new NeuronGraphManager({ neuronStore, hnswIndex: index });
  const chunkEngine = new ChunkEngine({ useCDC: false });
  const merkleEngine = new MerkleEngine();
  const embeddingProvider = new DeterministicEmbeddingProvider();
  const ingestionService = new IngestionService(
    chunkEngine, merkleEngine, graphManager, chunkStore, embeddingProvider
  );
  return { neuronStore, chunkStore, index, graphManager, ingestionService, embeddingProvider };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('E2E Performance Benchmark', () => {
  describe('Ingest throughput', () => {
    it('should ingest 10 docs at > 2 docs/sec', { timeout: 30_000 }, async () => {
      const { ingestionService } = createTestSystem();
      const texts = createFixtures(10);

      const start = performance.now();
      await ingestionService.ingestBatch(texts, { autoConnect: false });
      const elapsed = performance.now() - start;

      const docsPerSec = 10 / (elapsed / 1000);
      console.log(`[ingest-10] ${elapsed.toFixed(0)}ms → ${docsPerSec.toFixed(2)} docs/sec`);
      expect(docsPerSec).toBeGreaterThan(2);
    });

    it('should ingest 100 docs at > 2 docs/sec', { timeout: 60_000 }, async () => {
      const { ingestionService } = createTestSystem();
      const texts = createFixtures(100);

      const start = performance.now();
      await ingestionService.ingestBatch(texts, { autoConnect: false });
      const elapsed = performance.now() - start;

      const docsPerSec = 100 / (elapsed / 1000);
      console.log(`[ingest-100] ${elapsed.toFixed(0)}ms → ${docsPerSec.toFixed(2)} docs/sec`);
      expect(docsPerSec).toBeGreaterThan(2);
    });
  });

  describe('HNSW search latency', () => {
    it('should achieve p95 < 500ms with 50 neurons', { timeout: 60_000 }, async () => {
      const { index } = createTestSystem();

      // Populate index
      for (let i = 0; i < 50; i++) {
        index.insert(`n${i}`, makeEmbedding(i));
      }

      // Warmup
      for (let i = 0; i < 5; i++) {
        index.search(makeEmbedding(9999 + i), 10);
      }

      // Measure 50 searches
      const latencies: number[] = [];
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        index.search(makeEmbedding(100000 + i), 10);
        latencies.push(performance.now() - t0);
      }

      latencies.sort((a, b) => a - b);
      const p50 = computePercentile(latencies, 50);
      const p95 = computePercentile(latencies, 95);
      console.log(`[hnsw-50] p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);

      expect(p95).toBeLessThan(500);
    });

    it('should achieve p95 < 500ms with 500 neurons', { timeout: 120_000 }, async () => {
      const { index } = createTestSystem();

      // Populate index
      for (let i = 0; i < 500; i++) {
        index.insert(`n${i}`, makeEmbedding(i));
      }

      // Warmup
      for (let i = 0; i < 5; i++) {
        index.search(makeEmbedding(9999 + i), 10);
      }

      // Measure 50 searches
      const latencies: number[] = [];
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        index.search(makeEmbedding(100000 + i), 10);
        latencies.push(performance.now() - t0);
      }

      latencies.sort((a, b) => a - b);
      const p50 = computePercentile(latencies, 50);
      const p95 = computePercentile(latencies, 95);
      console.log(`[hnsw-500] p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);

      expect(p95).toBeLessThan(500);
    });
  });

  describe('Soft-delete performance', () => {
    it('should soft-delete at < 0.1ms per operation', { timeout: 30_000 }, async () => {
      const { index } = createTestSystem();
      const count = 1000;

      // Populate
      for (let i = 0; i < count; i++) {
        index.insert(`d${i}`, makeEmbedding(i));
      }

      const start = performance.now();
      for (let i = 0; i < count; i++) {
        index.delete(`d${i}`);
      }
      const elapsed = performance.now() - start;
      const perOp = elapsed / count;

      console.log(`[soft-delete] ${count} ops in ${elapsed.toFixed(2)}ms → ${perOp.toFixed(4)}ms/op`);
      expect(perOp).toBeLessThan(0.1);
    });
  });

  describe('Compact performance', () => {
    it('should compact 100 tombstones in < 5000ms', { timeout: 30_000 }, async () => {
      const { index } = createTestSystem();

      // Populate and soft-delete 100 nodes
      for (let i = 0; i < 100; i++) {
        index.insert(`c${i}`, makeEmbedding(i));
      }
      for (let i = 0; i < 100; i++) {
        index.delete(`c${i}`);
      }

      expect(index.tombstoneCount).toBe(100);

      const start = performance.now();
      const { removed } = index.compact();
      const elapsed = performance.now() - start;

      console.log(`[compact-100] removed=${removed} in ${elapsed.toFixed(2)}ms`);
      expect(removed).toBe(100);
      expect(elapsed).toBeLessThan(5000);
      expect(index.tombstoneCount).toBe(0);
    });
  });
});
