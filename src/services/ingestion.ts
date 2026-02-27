/**
 * Ingestion Service - Data ingestion pipeline
 * @module services/ingestion
 */

import type {
  UUID,
  Embedding384,
  NeuronNode,
  Chunk,
  MerkleTree,
  JobStatus,
  IChunkStore,
  SourceColumnSchema,
  SourceForeignKey,
  SourceIndex,
  SourceCheckConstraint,
  SourceTrigger,
} from '../types/index.js';
import { ChunkEngine } from '../core/chunk-engine.js';
import { MerkleEngine } from '../core/merkle-engine.js';
import { NeuronGraphManager } from '../core/neuron-graph.js';
import { generateUUID } from '../utils/uuid.js';
import { now } from '../utils/index.js';
import { DeterministicEmbeddingProvider } from './embedding-provider.js';

/**
 * Ingestion job
 */
export interface IngestionJob {
  id: UUID;
  status: JobStatus;
  progress: number;
  totalChunks: number;
  processedChunks: number;
  neuronId?: UUID;
  merkleRoot?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

/**
 * Ingestion options
 */
export interface IngestionOptions {
  sourceType?: string;
  tags?: string[];
  useCDC?: boolean;
  chunkSize?: number;
  autoConnect?: boolean;
  connectionThreshold?: number;
  sourceRow?: Record<string, unknown>;
  sourceColumns?: SourceColumnSchema[];
  sourceForeignKeys?: SourceForeignKey[];
  sourceIndexes?: SourceIndex[];
  sourceChecks?: SourceCheckConstraint[];
  sourceTriggers?: SourceTrigger[];
  sourceTable?: string;
  sourceEngine?: string;
  sourceCharset?: string;
  sourcePath?: string;
  sourceName?: string;
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<Embedding384>;
  embedBatch(texts: string[]): Promise<Embedding384[]>;
}



/**
 * Ingestion Service
 */
export class IngestionService {
  private chunkEngine: ChunkEngine;
  private merkleEngine: MerkleEngine;
  private graphManager: NeuronGraphManager;
  private chunkStore: IChunkStore;
  private embeddingProvider: EmbeddingProvider;
  private jobs: Map<UUID, IngestionJob>;

  constructor(
    chunkEngine: ChunkEngine,
    merkleEngine: MerkleEngine,
    graphManager: NeuronGraphManager,
    chunkStore: IChunkStore,
    embeddingProvider?: EmbeddingProvider
  ) {
    this.chunkEngine = chunkEngine;
    this.merkleEngine = merkleEngine;
    this.graphManager = graphManager;
    this.chunkStore = chunkStore;
    this.embeddingProvider = embeddingProvider ?? new DeterministicEmbeddingProvider();
    this.jobs = new Map();
  }

  /**
   * Ingest text data
   */
  async ingestText(
    text: string,
    options: IngestionOptions = {}
  ): Promise<NeuronNode> {
    const data = Buffer.from(text, 'utf-8');
    return this.ingestBuffer(data, options);
  }

  /**
   * Ingest binary data
   */
  async ingestBuffer(
    data: Buffer,
    options: IngestionOptions = {}
  ): Promise<NeuronNode> {
    // Create job
    const jobId = generateUUID();
    const job: IngestionJob = {
      id: jobId,
      status: 'PENDING',
      progress: 0,
      totalChunks: 0,
      processedChunks: 0,
      startedAt: now()
    };
    this.jobs.set(jobId, job);

    try {
      job.status = 'RUNNING';

      // Configure chunk engine
      if (options.useCDC !== undefined || options.chunkSize !== undefined) {
        this.chunkEngine = new ChunkEngine({
          useCDC: options.useCDC,
          chunkSize: options.chunkSize
        });
      }

      // Chunk the data
      const chunks = this.chunkEngine.chunk(data);
      job.totalChunks = chunks.length;

      // Store chunks
      for (const chunk of chunks) {
        await this.chunkStore.put(chunk);
        job.processedChunks++;
        job.progress = (job.processedChunks / job.totalChunks) * 50;
      }

      // Build Merkle tree from chunk hashes
      const chunkHashes = chunks.map(c => c.hash);
      const merkleTree = this.merkleEngine.buildTree(chunkHashes);

      job.merkleRoot = merkleTree.root;
      job.progress = 60;

      // Generate embedding from text content
      const text = data.toString('utf-8');
      const embedding = await this.embeddingProvider.embed(text);

      job.progress = 80;

      // Create neuron
      const neuron = await this.graphManager.createNeuron({
        embedding,
        chunkHashes,
        merkleRoot: merkleTree.root,
        sourceType: options.sourceType ?? 'text',
        tags: options.tags,
        autoConnect: options.autoConnect,
        connectionThreshold: options.connectionThreshold,
        sourceRow: options.sourceRow,
        sourceColumns: options.sourceColumns,
        sourceForeignKeys: options.sourceForeignKeys,
        sourceIndexes: options.sourceIndexes,
        sourceChecks: options.sourceChecks,
        sourceTriggers: options.sourceTriggers,
        sourceTable: options.sourceTable,
        sourceEngine: options.sourceEngine,
        sourceCharset: options.sourceCharset,
        sourcePath: options.sourcePath,
        sourceName: options.sourceName,
      });

      job.neuronId = neuron.id;
      job.status = 'COMPLETED';
      job.progress = 100;
      job.completedAt = now();

      return neuron;
    } catch (error) {
      job.status = 'FAILED';
      job.error = (error as Error).message;
      job.completedAt = now();
      throw error;
    }
  }

  /**
   * Ingest multiple texts as separate neurons
   */
  async ingestBatch(
    texts: string[],
    options: IngestionOptions = {}
  ): Promise<NeuronNode[]> {
    const neurons: NeuronNode[] = [];

    for (const text of texts) {
      const neuron = await this.ingestText(text, options);
      neurons.push(neuron);
    }

    return neurons;
  }

  /**
   * Start async ingestion job
   */
  async startIngestionJob(
    data: Buffer,
    options: IngestionOptions = {}
  ): Promise<UUID> {
    const jobId = generateUUID();
    const job: IngestionJob = {
      id: jobId,
      status: 'PENDING',
      progress: 0,
      totalChunks: 0,
      processedChunks: 0,
      startedAt: now()
    };
    this.jobs.set(jobId, job);

    // Run in background
    this.runIngestionJob(jobId, data, options);

    return jobId;
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: UUID): IngestionJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: UUID): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'RUNNING') {
      return false;
    }

    job.status = 'CANCELLED';
    job.error = 'Cancelled by user';
    job.completedAt = now();
    return true;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): IngestionJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up completed jobs
   */
  cleanupJobs(olderThanMs: number = 3600000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, job] of this.jobs) {
      if (job.completedAt && new Date(job.completedAt).getTime() < cutoff) {
        this.jobs.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Set embedding provider
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Run ingestion job (internal)
   */
  private async runIngestionJob(
    jobId: UUID,
    data: Buffer,
    options: IngestionOptions
  ): Promise<void> {
    const job = this.jobs.get(jobId)!;

    try {
      job.status = 'RUNNING';

      // Chunk the data
      const chunks = this.chunkEngine.chunk(data);
      job.totalChunks = chunks.length;

      // Store chunks
      for (const chunk of chunks) {
        if (job.status !== 'RUNNING') return; // Check for cancellation
        await this.chunkStore.put(chunk);
        job.processedChunks++;
        job.progress = (job.processedChunks / job.totalChunks) * 50;
      }

      // Build Merkle tree
      const chunkHashes = chunks.map(c => c.hash);
      const merkleTree = this.merkleEngine.buildTree(chunkHashes);
      job.merkleRoot = merkleTree.root;
      job.progress = 60;

      // Generate embedding
      const text = data.toString('utf-8');
      const embedding = await this.embeddingProvider.embed(text);
      job.progress = 80;

      // Create neuron
      const neuron = await this.graphManager.createNeuron({
        embedding,
        chunkHashes,
        merkleRoot: merkleTree.root,
        sourceType: options.sourceType ?? 'text',
        tags: options.tags,
        autoConnect: options.autoConnect,
        connectionThreshold: options.connectionThreshold,
        sourceRow: options.sourceRow,
        sourceColumns: options.sourceColumns,
        sourceForeignKeys: options.sourceForeignKeys,
        sourceIndexes: options.sourceIndexes,
        sourceChecks: options.sourceChecks,
        sourceTriggers: options.sourceTriggers,
        sourceTable: options.sourceTable,
        sourceEngine: options.sourceEngine,
        sourceCharset: options.sourceCharset,
        sourcePath: options.sourcePath,
        sourceName: options.sourceName,
      });

      job.neuronId = neuron.id;
      job.status = 'COMPLETED';
      job.progress = 100;
      job.completedAt = now();
    } catch (error) {
      job.status = 'FAILED';
      job.error = (error as Error).message;
      job.completedAt = now();
    }
  }
}

/**
 * Create an IngestionService instance
 */
export function createIngestionService(
  chunkEngine: ChunkEngine,
  merkleEngine: MerkleEngine,
  graphManager: NeuronGraphManager,
  chunkStore: IChunkStore,
  embeddingProvider?: EmbeddingProvider
): IngestionService {
  return new IngestionService(
    chunkEngine,
    merkleEngine,
    graphManager,
    chunkStore,
    embeddingProvider
  );
}
