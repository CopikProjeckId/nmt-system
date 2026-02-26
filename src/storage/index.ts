/**
 * Storage Layer Export
 *
 * LevelDB 기반 영속 스토리지
 *
 * @module storage
 */

// ============== LevelDB Stores (Persistent) ==============
export {
  ChunkStore,
  createChunkStore
} from './chunk-store.js';
export type { ChunkStoreOptions } from './chunk-store.js';

export {
  NeuronStore,
  createNeuronStore
} from './neuron-store.js';
export type { NeuronStoreOptions } from './neuron-store.js';

export {
  IndexStore,
  createIndexStore
} from './index-store.js';
export type { IndexStoreOptions } from './index-store.js';

// ============== Probabilistic Ontology Store ==============
export {
  ProbabilisticStore,
  createProbabilisticStore
} from './probabilistic-store.js';
export type { ProbabilisticStoreOptions } from './probabilistic-store.js';

// ============== Storage Configuration ==============

export type StorageBackend = 'leveldb';

/**
 * Storage configuration
 */
export interface StorageConfig {
  backend: StorageBackend;
  dataDir: string;
}

/**
 * Get storage configuration from environment
 */
export function getStorageConfig(): StorageConfig {
  return {
    backend: 'leveldb',
    dataDir: process.env.NMT_DATA_DIR || './data'
  };
}

/**
 * Print storage backend info
 */
export function printStorageInfo(): void {
  const config = getStorageConfig();

  console.log('\n=== NMT Storage Configuration ===');
  console.log(`Backend: ${config.backend}`);
  console.log(`Data Directory: ${config.dataDir}`);
  console.log('Status: Persistent (LevelDB)');
  console.log('Data is stored on disk and survives restarts.');
  console.log('================================\n');
}

import { ChunkStore } from './chunk-store.js';
import { NeuronStore } from './neuron-store.js';
import { IndexStore } from './index-store.js';
import { ProbabilisticStore } from './probabilistic-store.js';

/**
 * Create stores based on configuration
 */
export function createStores(config?: StorageConfig): {
  chunkStore: ChunkStore;
  neuronStore: NeuronStore;
  indexStore: IndexStore;
  probabilisticStore: ProbabilisticStore;
} {
  const cfg = config || getStorageConfig();
  const options = { dataDir: cfg.dataDir };

  return {
    chunkStore: new ChunkStore(options),
    neuronStore: new NeuronStore(options),
    indexStore: new IndexStore(options),
    probabilisticStore: new ProbabilisticStore(options)
  };
}
