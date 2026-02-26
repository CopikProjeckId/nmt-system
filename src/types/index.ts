/**
 * NMT (Neuron Merkle Tree) TypeScript Type Definitions
 * @module nmt-types
 * @version 1.0.0
 */

// ============================================================================
// Core Types
// ============================================================================

/** UUID v4 string format */
export type UUID = string;

/** SHA3-256 hash string (64 hex characters) */
export type SHA3Hash = string;

/** ISO 8601 timestamp string */
export type ISO8601 = string;

/** 384-dimensional embedding vector */
export type Embedding384 = Float32Array;

/** Merkle root hash */
export type MerkleRoot = SHA3Hash;

// ============================================================================
// Enums (as string literal types for easier use)
// ============================================================================

/** Types of synaptic connections between neurons */
export type SynapseType =
  | 'SEMANTIC'
  | 'TEMPORAL'
  | 'CAUSAL'
  | 'ASSOCIATIVE'
  | 'HIERARCHICAL'
  | 'DUPLICATE';

/**
 * Neuron Type - Fact vs Transient classification
 * 설계 문서: NMT_Updated.md 4.1절
 */
export type NeuronType =
  | 'fact'       // 장기 재사용 지식 (정책/스펙/규칙/검증된 해결책/템플릿)
  | 'transient'; // 일회성 대화/시도 로그/잡담/임시 상태

/** Status of async operations */
export type JobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Graph traversal strategies */
export type TraversalStrategy =
  | 'BFS'
  | 'DFS'
  | 'WEIGHTED'
  | 'RANDOM_WALK';

/** Component health status */
export type ComponentStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE';

// ============================================================================
// Chunk Types
// ============================================================================

/** A data chunk */
export interface Chunk {
  index: number;
  offset: number;
  data: Buffer;
  hash: SHA3Hash;
  fingerprint?: number;
}

/** Options for chunking operations */
export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
  useCDC?: boolean;
  minChunkSize?: number;
  maxChunkSize?: number;
}

// ============================================================================
// Neuron Types
// ============================================================================

/** Metadata attached to a neuron */
export interface NeuronMetadata {
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessed: string;
  sourceType: string;
  tags: string[];
  // Fact vs Transient 분류 (NMT_Updated.md 4.1절)
  neuronType?: NeuronType;       // 뉴런 타입 (기본: 'fact')
  ttl?: number;                  // Transient만: 만료 시간(ms)
  expiresAt?: number;            // Transient만: 만료 타임스탬프
  importance?: number;           // 중요도 점수 (0-1)
  verifiedAt?: string;           // 마지막 검증 시간
}

/** Core neuron data structure */
export interface NeuronNode {
  id: UUID;
  embedding: Embedding384;
  chunkHashes: SHA3Hash[];
  merkleRoot: MerkleRoot;
  metadata: NeuronMetadata;
  outgoingSynapses: UUID[];
  incomingSynapses: UUID[];
}

// ============================================================================
// Synapse Types
// ============================================================================

/** Metadata for a synaptic connection */
export interface SynapseMetadata {
  createdAt: string;
  updatedAt: string;
  activationCount: number;
  lastActivated: string;
  bidirectional: boolean;
}

/** Synaptic connection between neurons */
export interface Synapse {
  id: UUID;
  sourceId: UUID;
  targetId: UUID;
  weight: number;
  type: SynapseType;
  metadata: SynapseMetadata;
}

// ============================================================================
// Merkle Tree Types
// ============================================================================

/** Merkle tree structure */
export interface MerkleTree {
  root: MerkleRoot;
  levels: SHA3Hash[][];
  leafCount: number;
  originalLeaves: SHA3Hash[];
}

/** Merkle inclusion proof */
export interface MerkleProof {
  leaf: SHA3Hash;
  leafIndex: number;
  siblings: SHA3Hash[];
  directions: boolean[];
  root: MerkleRoot;
}

// ============================================================================
// HNSW Index Types
// ============================================================================

/** HNSW index parameters */
export interface HNSWParams {
  M: number;
  efConstruction: number;
  efSearch: number;
  mL: number;
}

/** HNSW node structure */
export interface HNSWNode {
  id: UUID;
  embedding: Embedding384;
  layer: number;
  connections: Map<number, Set<UUID>>;
}

/** HNSW layer structure */
export interface HNSWLayer {
  level: number;
  nodes: Set<UUID>;
}

/** Full HNSW index structure (serialized format) */
export interface HNSWIndexData {
  params: HNSWParams;
  layers: HNSWLayer[];
  entryPoint: UUID | null;
  nodes: HNSWNode[];
}

/** @deprecated Use HNSWIndexData instead */
export type HNSWIndexType = HNSWIndexData;

/** Search result from HNSW */
export interface SearchResult {
  id: UUID;
  score: number;
  distance: number;
}

// ============================================================================
// Graph Types
// ============================================================================

/** Neuron path through the graph */
export interface NeuronPath {
  neurons: NeuronNode[];
  synapses: Synapse[];
  totalWeight: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

// ============================================================================
// Storage Interfaces
// ============================================================================

/**
 * ChunkStore interface - both LevelDB and Redis implementations satisfy this
 */
export interface IChunkStore {
  init(): Promise<void>;
  close(): Promise<void>;
  put(chunk: Chunk): Promise<SHA3Hash>;
  putMany(chunks: Chunk[]): Promise<SHA3Hash[]>;
  get(chunkHash: SHA3Hash): Promise<Chunk | null>;
  getMany(hashes: SHA3Hash[]): Promise<(Chunk | null)[]>;
  has(chunkHash: SHA3Hash): Promise<boolean>;
  delete(chunkHash: SHA3Hash): Promise<boolean>;
  getAllHashes(): Promise<SHA3Hash[]>;
  getStats(): Promise<{ totalChunks: number; totalSize: number; avgChunkSize: number }>;
  verifyIntegrity(): Promise<{ valid: number; corrupted: SHA3Hash[]; missing: SHA3Hash[] }>;
  gc(): Promise<number>;
}

/**
 * NeuronStore interface - both LevelDB and Redis implementations satisfy this
 */
export interface INeuronStore {
  init(): Promise<void>;
  close(): Promise<void>;
  createNeuron(input: {
    embedding: Embedding384;
    chunkHashes: string[];
    merkleRoot: string;
    sourceType?: string;
    tags?: string[];
  }): Promise<NeuronNode>;
  putNeuron(neuron: NeuronNode): Promise<void>;
  getNeuron(id: UUID): Promise<NeuronNode | null>;
  getNeuronByMerkleRoot(merkleRoot: string): Promise<NeuronNode | null>;
  updateNeuron(id: UUID, updates: Partial<NeuronNode>): Promise<NeuronNode | null>;
  deleteNeuron(id: UUID): Promise<boolean>;
  recordAccess(id: UUID): Promise<void>;
  getAllNeuronIds(): Promise<UUID[]>;
  getNeuronCount(): Promise<number>;
  createSynapse(
    sourceId: UUID,
    targetId: UUID,
    type: SynapseType,
    weight?: number,
    bidirectional?: boolean
  ): Promise<Synapse | null>;
  putSynapse(synapse: Synapse): Promise<void>;
  getSynapse(id: UUID): Promise<Synapse | null>;
  getOutgoingSynapses(neuronId: UUID): Promise<Synapse[]>;
  getIncomingSynapses(neuronId: UUID): Promise<Synapse[]>;
  updateSynapseWeight(id: UUID, weight: number): Promise<Synapse | null>;
  recordSynapseActivation(id: UUID): Promise<void>;
  deleteSynapse(id: UUID): Promise<boolean>;
  getSynapseCount(): Promise<number>;
  findSimilar(embedding: Embedding384, k: number): Promise<NeuronNode[]>;
}

/**
 * IndexStore interface - for HNSW index persistence
 */
export interface IIndexStore {
  init(): Promise<void>;
  close(): Promise<void>;
  save(name: string, index: any): Promise<void>;
  load(name: string): Promise<any | null>;
  delete(name: string): Promise<boolean>;
  list(): Promise<string[]>;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG = {
  HNSW: {
    M: 16,
    efConstruction: 200,
    efSearch: 50
  },
  CHUNKING: {
    defaultChunkSize: 4096,
    minChunkSize: 256,
    maxChunkSize: 65536
  },
  EMBEDDING: {
    dimensions: 384
  }
} as const;
