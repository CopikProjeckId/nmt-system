#!/usr/bin/env node
/**
 * NMT CLI - Direct Core Engine Access
 * Database-style command-line interface for Neuron Merkle Tree system
 *
 * All commands operate directly on the local DB without requiring a running server.
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const VERSION = '1.0.0';

const HELP = `
NMT - Neuron Merkle Tree CLI v${VERSION}
확률적 존재론 기반 지식 그래프 시스템

Usage: nmt <command> [options]

Core Commands:
  init                  Initialize NMT data directory
  dashboard             Start lightweight web admin dashboard
  mcp                   Start MCP (Model Context Protocol) server for Claude Code

  ingest <file>         Ingest a text file into the knowledge graph
  ingest-text <text>    Ingest text directly from command line
  search <query>        Semantic search across neurons
  verify [id]           Verify neuron integrity (all if no id given)
  list                  List stored neurons
  get <id>              Get neuron details with content
  stats                 Show system statistics with real DB counts

Probabilistic Ontology (확률적 존재론):
  infer <sub>           Bidirectional inference (forward|backward|causal|bidirectional)
  attractor <sub>       Future attractor management (create|list|influence|path)
  learn <sub>           4-stage learning (interaction|patterns|outcomes|stats)
  dimension <sub>       Dynamic dimensions (list|expand|analyze|stats)
  sync <sub>            State synchronization (status|changes|export|import|peers)

  benchmark             Run performance benchmarks

Options:
  -h, --help            Show this help message
  -v, --version         Show version number
  -d, --data-dir        Data directory (default: ./data)
  -p, --port            Dashboard port (default: 3000)
  -k, --top-k           Number of results (default: 10)
  -t, --tags            Comma-separated tags for ingest
  -s, --source-type     Source type label (default: cli)
  --content             Include full content in search results
  --json                Output as JSON
  --depth               Inference depth (default: 3)
  --strength            Attractor strength (default: 1.0)

Environment Variables:
  NMT_DATA_DIR          Data directory path

Examples:
  nmt init
  nmt dashboard -p 4000
  nmt mcp                                 # Start MCP server for Claude Code
  nmt ingest ./docs/article.txt -t "ml,tutorial"
  nmt search "machine learning" -k 5
  nmt stats

  # Probabilistic Ontology
  nmt infer forward <neuron-id>           # Forward causation
  nmt infer backward <neuron-id>          # Abductive reasoning
  nmt attractor create "goal" --strength 0.8
  nmt learn interaction --input "..." --output "..."
  nmt dimension expand --name "concept" --category "custom"

  # Claude Code Integration (MCP)
  # Add to ~/.claude/settings.json:
  # { "mcpServers": { "nmt": { "command": "nmt", "args": ["mcp"] } } }
`;

// ============== Config ==============

interface Config {
  dataDir: string;
  port: number;
  topK: number;
  json: boolean;
  tags: string[];
  sourceType: string;
  includeContent: boolean;
}

function parseConfig(): { command: string; args: string[]; config: Config } {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      'data-dir': { type: 'string', short: 'd', default: './data' },
      port: { type: 'string', short: 'p', default: '3000' },
      'top-k': { type: 'string', short: 'k', default: '10' },
      tags: { type: 'string', short: 't' },
      'source-type': { type: 'string', short: 's', default: 'cli' },
      content: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (values.version) {
    console.log(VERSION);
    process.exit(0);
  }

  const command = positionals[0] || 'help';
  const args = positionals.slice(1);
  const tagsStr = values.tags as string | undefined;

  return {
    command,
    args,
    config: {
      dataDir: values['data-dir'] as string,
      port: parseInt(values.port as string, 10),
      topK: parseInt(values['top-k'] as string, 10),
      json: values.json as boolean,
      tags: tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [],
      sourceType: values['source-type'] as string,
      includeContent: values.content as boolean,
    },
  };
}

// ============== NMT Context (Lazy Bootstrap) ==============

interface NMTContext {
  chunkEngine: any;
  merkleEngine: any;
  hnswIndex: any;
  graphManager: any;
  chunkStore: any;
  neuronStore: any;
  indexStore: any;
  probabilisticStore: any;
  ingestionService: any;
  queryService: any;
  verifyService: any;
  // Probabilistic Ontology Extensions
  inferenceEngine?: any;
  attractorModel?: any;
  learningSystem?: any;
  neuronManager?: any;
  embeddingManager?: any;
  // State Sync Extensions
  syncManager?: any;
  changeJournal?: any;
  eventBus?: any;
  journalDb?: any;
}

let _ctx: NMTContext | null = null;

async function bootstrap(config: Config): Promise<NMTContext> {
  if (_ctx) return _ctx;

  const { ChunkEngine } = await import('../src/core/chunk-engine.js');
  const { MerkleEngine } = await import('../src/core/merkle-engine.js');
  const { HNSWIndex } = await import('../src/core/hnsw-index.js');
  const { NeuronGraphManager } = await import('../src/core/neuron-graph.js');
  const { createStores, getStorageConfig } = await import('../src/storage/index.js');
  const { IngestionService } = await import('../src/services/ingestion.js');
  const { QueryService } = await import('../src/services/query.js');
  const { VerificationService } = await import('../src/services/verify.js');

  // Ensure data directory exists
  const dataDir = resolve(config.dataDir);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Initialize stores based on env config
  const storageConfig = getStorageConfig();
  storageConfig.dataDir = config.dataDir;
  const { chunkStore, neuronStore, indexStore, probabilisticStore } = createStores(storageConfig);

  await chunkStore.init();
  await neuronStore.init();
  await indexStore.init();
  await probabilisticStore.init();

  // Core engines
  const chunkEngine = new ChunkEngine();
  const merkleEngine = new MerkleEngine();

  // Load existing HNSW index or create new
  // IndexStore.load() returns HNSWIndex instance directly (handles deserialization internally)
  let hnswIndex: any;
  try {
    const loaded = await indexStore.load('main');
    hnswIndex = loaded ?? new HNSWIndex();
  } catch {
    hnswIndex = new HNSWIndex();
  }

  // Graph manager (with lower threshold for auto-connect)
  const graphManager = new NeuronGraphManager({
    neuronStore,
    hnswIndex,
    semanticThreshold: 0.3,  // Lower threshold for more connections
  });

  // Embedding Provider (Xenova)
  const { getEmbeddingProvider } = await import('../src/services/embedding-provider.js');
  const embeddingProvider = await getEmbeddingProvider();

  // Services
  const ingestionService = new IngestionService(
    chunkEngine, merkleEngine, graphManager, chunkStore, embeddingProvider
  );
  const queryService = new QueryService(
    graphManager, merkleEngine, chunkStore, neuronStore
  );
  const verifyService = new VerificationService(
    merkleEngine, chunkStore, neuronStore
  );

  // Probabilistic Ontology Extensions (확률적 존재론)
  let inferenceEngine: any;
  let attractorModel: any;
  let learningSystem: any;
  let neuronManager: any;
  let embeddingManager: any;

  try {
    const { BidirectionalInferenceEngine } = await import('../src/core/bidirectional-inference.js');
    const { AttractorModel } = await import('../src/core/attractor-model.js');
    const { FourStageLearningSystem } = await import('../src/services/four-stage-learning.js');
    const { ProbabilisticNeuronManager } = await import('../src/core/probabilistic-neuron.js');
    const { DynamicEmbeddingManager } = await import('../src/core/dynamic-embedding.js');

    inferenceEngine = new BidirectionalInferenceEngine({ neuronStore, graphManager });
    attractorModel = new AttractorModel({ neuronStore });
    learningSystem = new FourStageLearningSystem({ neuronStore, graphManager });
    neuronManager = new ProbabilisticNeuronManager({ neuronStore });
    embeddingManager = new DynamicEmbeddingManager({ baseDimension: 384 });

    // Load saved state from disk
    const savedStates = await probabilisticStore.loadAll();
    if (savedStates.attractors && attractorModel.load) {
      attractorModel.load(savedStates.attractors);
    }
    if (savedStates.neurons && neuronManager.load) {
      neuronManager.load(savedStates.neurons);
    }
    if (savedStates.dimensions && embeddingManager.loadDimensions) {
      embeddingManager.loadDimensions(savedStates.dimensions);
    }
  } catch (err: any) {
    // Probabilistic modules are optional - graceful degradation
    console.warn(`Note: Probabilistic extensions not fully loaded: ${err.message}`);
  }

  // State Synchronization (상태 동기화)
  let syncManager: any;
  let changeJournal: any;
  let eventBus: any;
  let journalDb: any;

  try {
    const { EventBus } = await import('../src/events/event-bus.js');
    const { ChangeJournal } = await import('../src/sync/change-journal.js');
    const { StateSyncManager } = await import('../src/sync/state-sync.js');
    const { Level } = await import('level');

    eventBus = new EventBus();

    // Create a separate LevelDB for sync journal
    const journalDbPath = resolve(config.dataDir, 'journal');
    if (!existsSync(journalDbPath)) {
      mkdirSync(journalDbPath, { recursive: true });
    }
    journalDb = new Level<string, string>(journalDbPath, { valueEncoding: 'json' });
    await journalDb.open();

    // Generate crypto-safe unique node ID to avoid collisions
    const nodeId = `node-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    changeJournal = new ChangeJournal(journalDb, nodeId);

    syncManager = new StateSyncManager({
      nodeId,
      journal: changeJournal,
      merkleEngine,
      eventBus,
    });

    await syncManager.init();
  } catch (err: any) {
    // Sync modules are optional - graceful degradation
    console.warn(`Note: Sync extensions not fully loaded: ${err.message}`);
  }

  _ctx = {
    chunkEngine, merkleEngine, hnswIndex, graphManager,
    chunkStore, neuronStore, indexStore, probabilisticStore,
    ingestionService, queryService, verifyService,
    // Probabilistic extensions
    inferenceEngine, attractorModel, learningSystem,
    neuronManager, embeddingManager,
    // Sync extensions
    syncManager, changeJournal, eventBus, journalDb,
  };

  return _ctx;
}

async function shutdown(): Promise<void> {
  if (!_ctx) return;
  try {
    // Save HNSW index
    await _ctx.indexStore.save('main', _ctx.hnswIndex);

    // Save probabilistic module states
    if (_ctx.probabilisticStore) {
      const states: any = {};
      if (_ctx.attractorModel?.serialize) {
        states.attractors = _ctx.attractorModel.serialize();
      }
      if (_ctx.neuronManager?.serialize) {
        states.neurons = _ctx.neuronManager.serialize();
      }
      if (_ctx.embeddingManager?.serializeDimensions) {
        states.dimensions = _ctx.embeddingManager.serializeDimensions();
      }
      await _ctx.probabilisticStore.saveAll(states);
      await _ctx.probabilisticStore.close();
    }

    await _ctx.chunkStore.close();
    await _ctx.neuronStore.close();
    await _ctx.indexStore.close();

    // Close journal DB if initialized
    if (_ctx.journalDb) {
      await _ctx.journalDb.close();
    }
  } catch {
    // Ignore shutdown errors
  }
  _ctx = null;
}

// ============== Output Helpers ==============

function log(message: string, config: Config, data?: object) {
  if (config.json && data) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(message);
  }
}

function truncate(text: string, maxLen: number = 200): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ============== Commands: Setup ==============

async function cmdInit(config: Config) {
  const dirs = [
    config.dataDir,
    `${config.dataDir}/chunks`,
    `${config.dataDir}/neurons`,
    `${config.dataDir}/index`,
    `${config.dataDir}/models`,
  ];

  for (const dir of dirs) {
    const fullPath = resolve(dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      log(`  Created: ${fullPath}`, config);
    } else {
      log(`  Exists:  ${fullPath}`, config);
    }
  }

  const configPath = resolve(config.dataDir, 'config.json');
  if (!existsSync(configPath)) {
    const defaultConfig = {
      version: VERSION,
      hnsw: { M: 16, efConstruction: 200, efSearch: 50 },
      chunking: { size: 4096, overlap: 256 },
      embedding: { model: 'Xenova/all-MiniLM-L6-v2', dimension: 384 },
    };
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    log(`  Created config: ${configPath}`, config);
  }

  log('\n  NMT initialized successfully!', config, { status: 'success', dataDir: config.dataDir });
}

async function cmdDashboard(config: Config) {
  log(`Starting NMT Dashboard...`, config);
  log(`Data directory: ${resolve(config.dataDir)}`, config);

  try {
    const { CLIDashboardServer } = await import('../src/api/cli-server.js');
    const server = new CLIDashboardServer({
      port: config.port,
      dataDir: config.dataDir,
    });

    const shutdown = async () => {
      console.log('\nShutting down dashboard...');
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await server.start();
    log(`\nPress Ctrl+C to stop\n`, config);
  } catch (error: any) {
    console.error('Failed to start dashboard:', error.message);
    process.exit(1);
  }
}

// ============== Commands: MCP Server ==============

async function cmdMcp(config: Config) {
  log(`Starting NMT MCP Server...`, config);
  log(`Data directory: ${resolve(config.dataDir)}`, config);

  try {
    const { NMTMCPServer } = await import('../src/mcp/server.js');
    const server = new NMTMCPServer(config.dataDir);

    // Handle shutdown signals
    const shutdown = async () => {
      console.error('\nShutting down MCP server...');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Initialize and start
    await server.init();
    await server.start();
  } catch (error: any) {
    console.error('Failed to start MCP server:', error.message);
    process.exit(1);
  }
}

// ============== Commands: Core DB Operations ==============

async function cmdIngest(args: string[], config: Config) {
  if (args.length === 0) {
    console.error('Error: No file specified');
    console.log('Usage: nmt ingest <file> [-t tags] [-s source-type]');
    process.exit(1);
  }

  const filePath = resolve(args[0]);
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const ctx = await bootstrap(config);
  const fileName = basename(filePath);
  const fileSize = statSync(filePath).size;

  log(`Ingesting: ${fileName} (${formatBytes(fileSize)})`, config);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const tags = config.tags.length > 0 ? config.tags : [fileName];

    const neuron = await ctx.ingestionService.ingestText(content, {
      sourceType: config.sourceType || 'file',
      tags,
      autoConnect: true,
    });

    if (config.json) {
      log('', config, {
        status: 'success',
        neuronId: neuron.id,
        merkleRoot: neuron.merkleRoot,
        chunks: neuron.chunkHashes.length,
        tags: neuron.metadata.tags,
        sourceType: neuron.metadata.sourceType,
      });
    } else {
      log('', config);
      log(`  Neuron ID:    ${neuron.id}`, config);
      log(`  Merkle Root:  ${neuron.merkleRoot.substring(0, 16)}...`, config);
      log(`  Chunks:       ${neuron.chunkHashes.length}`, config);
      log(`  Tags:         ${neuron.metadata.tags.join(', ')}`, config);
      log(`  Source:       ${neuron.metadata.sourceType}`, config);
      log(`\n  Ingested successfully!`, config);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Ingestion failed:', error.message);
    process.exit(1);
  }
}

async function cmdIngestText(args: string[], config: Config) {
  if (args.length === 0) {
    console.error('Error: No text specified');
    console.log('Usage: nmt ingest-text "your text here" [-t tags]');
    process.exit(1);
  }

  const text = args.join(' ');
  const ctx = await bootstrap(config);

  log(`Ingesting text (${formatBytes(Buffer.byteLength(text))})...`, config);

  try {
    const neuron = await ctx.ingestionService.ingestText(text, {
      sourceType: config.sourceType || 'text',
      tags: config.tags,
      autoConnect: true,
    });

    if (config.json) {
      log('', config, {
        status: 'success',
        neuronId: neuron.id,
        merkleRoot: neuron.merkleRoot,
        chunks: neuron.chunkHashes.length,
        tags: neuron.metadata.tags,
      });
    } else {
      log('', config);
      log(`  Neuron ID:    ${neuron.id}`, config);
      log(`  Merkle Root:  ${neuron.merkleRoot.substring(0, 16)}...`, config);
      log(`  Chunks:       ${neuron.chunkHashes.length}`, config);
      log(`  Tags:         ${neuron.metadata.tags.join(', ') || '(none)'}`, config);
      log(`\n  Ingested successfully!`, config);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Ingestion failed:', error.message);
    process.exit(1);
  }
}

async function cmdSearch(args: string[], config: Config) {
  if (args.length === 0) {
    console.error('Error: No query specified');
    console.log('Usage: nmt search <query> [-k top-k] [--content]');
    process.exit(1);
  }

  const query = args.join(' ');
  const ctx = await bootstrap(config);

  log(`Searching: "${query}" (top ${config.topK})`, config);
  log('', config);

  try {
    const results = await ctx.queryService.search(query, {
      k: config.topK,
      includeContent: config.includeContent,
    });

    if (config.json) {
      log('', config, {
        query,
        total: results.length,
        results: results.map((r: any) => ({
          neuronId: r.neuron.id,
          score: r.score,
          tags: r.neuron.metadata.tags,
          sourceType: r.neuron.metadata.sourceType,
          ...(r.content ? { content: r.content } : {}),
        })),
      });
    } else {
      if (results.length === 0) {
        log('  No results found.', config);
      } else {
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const score = r.score.toFixed(4);
          log(`  #${i + 1}  [${score}]  ${r.neuron.id}`, config);
          log(`      Tags: ${r.neuron.metadata.tags.join(', ') || '(none)'}  |  Source: ${r.neuron.metadata.sourceType}`, config);
          if (r.content) {
            log(`      Content: ${truncate(r.content.replace(/\n/g, ' '), 150)}`, config);
          }
          log('', config);
        }
      }
      log(`Found ${results.length} result(s).`, config);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Search failed:', error.message);
    process.exit(1);
  }
}

async function cmdVerify(args: string[], config: Config) {
  const ctx = await bootstrap(config);

  try {
    if (args.length === 0) {
      // Verify ALL neurons
      log('Verifying all neurons...', config);
      log('', config);

      const result = await ctx.verifyService.verifyAll();

      if (config.json) {
        log('', config, {
          total: result.total,
          valid: result.valid,
          invalid: result.invalid,
          results: result.results.map((r: any) => ({
            neuronId: r.neuronId,
            valid: r.valid,
            errors: r.errors,
          })),
        });
      } else {
        if (result.total === 0) {
          log('  No neurons found. Ingest data first.', config);
        } else {
          for (const r of result.results) {
            const status = r.valid ? '[OK]' : '[FAIL]';
            log(`  ${status} ${r.neuronId}`, config);
            if (!r.valid) {
              for (const err of r.errors) {
                log(`        ${err}`, config);
              }
            }
          }
          log('', config);
          log(`  Total: ${result.total}  |  Valid: ${result.valid}  |  Invalid: ${result.invalid}`, config);

          if (result.invalid === 0) {
            log('\n  All neurons verified successfully!', config);
          } else {
            log(`\n  ${result.invalid} neuron(s) failed verification.`, config);
          }
        }
      }
    } else {
      // Verify single neuron
      const id = args[0];
      log(`Verifying neuron: ${id}`, config);
      log('', config);

      const result = await ctx.verifyService.verifyNeuron(id);

      if (config.json) {
        log('', config, result);
      } else {
        const d = result.details;
        log(`  Chunks:     ${d.chunksVerified}/${d.chunksVerified + d.chunksFailed} verified ${d.chunksFailed === 0 ? '[OK]' : '[FAIL]'}`, config);
        log(`  Merkle:     ${d.merkleValid ? 'Valid [OK]' : 'Invalid [FAIL]'}`, config);
        log(`  Embedding:  ${d.embeddingValid ? 'Valid [OK]' : 'Invalid [FAIL]'}`, config);

        if (result.errors.length > 0) {
          log('', config);
          log('  Errors:', config);
          for (const err of result.errors) {
            log(`    - ${err}`, config);
          }
        }

        log('', config);
        log(`  Result: ${result.valid ? 'INTEGRITY OK' : 'INTEGRITY FAILED'}`, config);
      }
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Verification failed:', error.message);
    process.exit(1);
  }
}

async function cmdList(config: Config) {
  const ctx = await bootstrap(config);

  try {
    const allIds = await ctx.neuronStore.getAllNeuronIds();
    const total = allIds.length;
    const limit = Math.min(config.topK, total);
    const ids = allIds.slice(0, limit);

    if (config.json) {
      const neurons = [];
      for (const id of ids) {
        const n = await ctx.neuronStore.getNeuron(id);
        if (n) neurons.push({
          id: n.id,
          merkleRoot: n.merkleRoot,
          chunks: n.chunkHashes.length,
          sourceType: n.metadata.sourceType,
          tags: n.metadata.tags,
          createdAt: n.metadata.createdAt,
          accessCount: n.metadata.accessCount,
        });
      }
      log('', config, { total, showing: limit, neurons });
    } else {
      log(`Neurons (${total} total${total > limit ? `, showing ${limit}` : ''})`, config);
      log('='.repeat(80), config);

      if (total === 0) {
        log('\n  No neurons found. Ingest data first.\n', config);
      } else {
        log('', config);
        for (const id of ids) {
          const n = await ctx.neuronStore.getNeuron(id);
          if (!n) continue;

          const tags = n.metadata.tags.join(', ') || '-';
          const created = formatDate(n.metadata.createdAt);
          log(`  ${n.id}`, config);
          log(`    Type: ${n.metadata.sourceType}  |  Tags: ${tags}  |  Chunks: ${n.chunkHashes.length}  |  Created: ${created}`, config);
          log('', config);
        }

        if (total > limit) {
          log(`  ... and ${total - limit} more. Use -k ${total} to show all.`, config);
          log('', config);
        }
      }
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('List failed:', error.message);
    process.exit(1);
  }
}

async function cmdGet(args: string[], config: Config) {
  if (args.length === 0) {
    console.error('Error: No neuron ID specified');
    console.log('Usage: nmt get <id>');
    process.exit(1);
  }

  const id = args[0];
  const ctx = await bootstrap(config);

  try {
    const neuron = await ctx.neuronStore.getNeuron(id);

    if (!neuron) {
      console.error(`Neuron not found: ${id}`);
      await shutdown();
      process.exit(1);
    }

    // Reconstruct content from chunks
    let content = '';
    try {
      content = await ctx.queryService.getContent(neuron);
    } catch {
      content = '(unable to reconstruct content)';
    }

    // Get synapse counts
    let outCount = 0;
    let inCount = 0;
    try {
      const outgoing = await ctx.neuronStore.getOutgoingSynapses(neuron.id);
      const incoming = await ctx.neuronStore.getIncomingSynapses(neuron.id);
      outCount = outgoing?.length ?? 0;
      inCount = incoming?.length ?? 0;
    } catch {
      // Synapse info not available
    }

    if (config.json) {
      log('', config, {
        id: neuron.id,
        merkleRoot: neuron.merkleRoot,
        chunkHashes: neuron.chunkHashes,
        sourceType: neuron.metadata.sourceType,
        tags: neuron.metadata.tags,
        createdAt: neuron.metadata.createdAt,
        updatedAt: neuron.metadata.updatedAt,
        lastAccessed: neuron.metadata.lastAccessed,
        accessCount: neuron.metadata.accessCount,
        outgoingSynapses: outCount,
        incomingSynapses: inCount,
        content,
      });
    } else {
      log(`Neuron: ${neuron.id}`, config);
      log('='.repeat(60), config);
      log(`  Merkle Root:   ${neuron.merkleRoot}`, config);
      log(`  Source Type:   ${neuron.metadata.sourceType}`, config);
      log(`  Tags:          ${neuron.metadata.tags.join(', ') || '(none)'}`, config);
      log(`  Chunks:        ${neuron.chunkHashes.length}`, config);
      log(`  Synapses:      ${outCount} outgoing, ${inCount} incoming`, config);
      log(`  Created:       ${formatDate(neuron.metadata.createdAt)}`, config);
      log(`  Last Access:   ${formatDate(neuron.metadata.lastAccessed)}`, config);
      log(`  Access Count:  ${neuron.metadata.accessCount}`, config);
      log('', config);
      log('Content:', config);
      log('-'.repeat(60), config);
      log(content, config);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Get failed:', error.message);
    process.exit(1);
  }
}

async function cmdStats(config: Config) {
  const ctx = await bootstrap(config);

  try {
    // Gather real DB counts
    const neuronCount = await ctx.neuronStore.getNeuronCount();
    const synapseCount = await ctx.neuronStore.getSynapseCount();
    const chunkStats = await ctx.chunkStore.getStats();
    const hnswStats = ctx.hnswIndex.getStats();

    const { getStorageConfig } = await import('../src/storage/index.js');
    const storageConfig = getStorageConfig();

    const statsData = {
      storage: {
        backend: storageConfig.backend,
        dataDir: resolve(config.dataDir),
      },
      neurons: neuronCount,
      synapses: synapseCount,
      chunks: {
        total: chunkStats.totalChunks,
        totalSize: chunkStats.totalSize,
        avgSize: chunkStats.avgChunkSize,
      },
      hnsw: hnswStats,
    };

    if (config.json) {
      log('', config, statsData);
    } else {
      log('NMT System Statistics', config);
      log('=====================\n', config);
      log(`  Storage Backend:  ${storageConfig.backend}`, config);
      log(`  Data Directory:   ${resolve(config.dataDir)}`, config);
      log('', config);
      log(`  Neurons:          ${neuronCount}`, config);
      log(`  Synapses:         ${synapseCount}`, config);
      log(`  Chunks:           ${chunkStats.totalChunks}`, config);
      log(`  Total Data Size:  ${formatBytes(chunkStats.totalSize)}`, config);
      if (chunkStats.totalChunks > 0) {
        log(`  Avg Chunk Size:   ${formatBytes(chunkStats.avgChunkSize)}`, config);
      }
      log('', config);
      log(`  HNSW Vectors:     ${hnswStats.totalNodes}`, config);
      if (hnswStats.maxLayer >= 0) {
        log(`  HNSW Layers:      ${hnswStats.maxLayer + 1}`, config);
      }
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Stats failed:', error.message);
    process.exit(1);
  }
}

// ============== Commands: Graph Management ==============

async function cmdConnect(_args: string[], config: Config) {
  const ctx = await bootstrap(config);

  try {
    // Get all neuron IDs
    const neuronIds = await ctx.neuronStore.getAllNeuronIds();

    if (neuronIds.length < 2) {
      console.log('Need at least 2 neurons to create connections.');
      await shutdown();
      return;
    }

    console.log(`Scanning ${neuronIds.length} neurons for connections...`);
    console.log(`Threshold: 0.3`);
    console.log('');

    let totalConnections = 0;

    for (const neuronId of neuronIds) {
      const synapses = await ctx.graphManager.autoConnect(neuronId, 0.3);
      if (synapses.length > 0) {
        console.log(`  ${neuronId.substring(0, 8)}... → ${synapses.length} new connections`);
        totalConnections += synapses.length;
      }
    }

    console.log('');
    console.log(`Total new connections: ${totalConnections}`);

    // Show updated stats
    const synapseCount = await ctx.neuronStore.getSynapseCount();
    console.log(`Total synapses now: ${synapseCount}`);

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Connect failed:', error.message);
    process.exit(1);
  }
}

// ============== Commands: Benchmarks & Backup ==============

async function cmdBenchmark(config: Config) {
  log('Running NMT Benchmarks...', config);
  log('========================\n', config);

  const results: Record<string, number> = {};

  // HNSW Benchmark
  log('1. HNSW Index Benchmark', config);
  const { HNSWIndex } = await import('../src/core/hnsw-index.js');
  const hnsw = new HNSWIndex();

  const dim = 384;
  const count = 1000;

  const embeddings: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const emb = new Float32Array(dim);
    for (let j = 0; j < dim; j++) emb[j] = Math.random() - 0.5;
    embeddings.push(emb);
  }

  const insertStart = Date.now();
  for (let i = 0; i < count; i++) {
    hnsw.insert(`id${i}`, embeddings[i]);
  }
  results.insertMs = Date.now() - insertStart;
  log(`   Insert ${count} vectors: ${results.insertMs}ms (${(count / results.insertMs * 1000).toFixed(0)} vec/s)`, config);

  const searchStart = Date.now();
  const searches = 100;
  for (let i = 0; i < searches; i++) {
    hnsw.search(embeddings[i % count], 10);
  }
  results.searchMs = Date.now() - searchStart;
  log(`   Search ${searches} queries: ${results.searchMs}ms (${(searches / results.searchMs * 1000).toFixed(0)} q/s)`, config);

  // Merkle Benchmark
  log('\n2. Merkle Tree Benchmark', config);
  const { MerkleEngine } = await import('../src/core/merkle-engine.js');
  const merkle = new MerkleEngine();

  const leaves = Array.from({ length: 1000 }, (_, i) => `leaf${i}`);

  const treeStart = Date.now();
  const tree = merkle.buildTree(leaves);
  results.treeBuildMs = Date.now() - treeStart;
  log(`   Build tree (${leaves.length} leaves): ${results.treeBuildMs}ms`, config);

  const proofStart = Date.now();
  for (let i = 0; i < 100; i++) {
    merkle.generateProof(tree, i);
  }
  results.proofGenMs = Date.now() - proofStart;
  log(`   Generate 100 proofs: ${results.proofGenMs}ms`, config);

  // Summary
  log('\nBenchmark Summary', config, results);
  log('====================', config);
  log(`HNSW Insert: ${(count / results.insertMs * 1000).toFixed(0)} vectors/sec`, config);
  log(`HNSW Search: ${(searches / results.searchMs * 1000).toFixed(0)} queries/sec`, config);
  log(`Merkle Build: ${results.treeBuildMs}ms for ${leaves.length} leaves`, config);
  log(`Proof Gen: ${(100 / results.proofGenMs * 1000).toFixed(0)} proofs/sec`, config);
}


// ============== Probabilistic Ontology Command Dispatchers ==============

async function cmdInferDispatch(args: string[], config: Config) {
  if (args.length === 0) {
    console.log('Usage: nmt infer <subcommand> [options]');
    console.log('Subcommands: forward, backward, causal, bidirectional');
    return;
  }

  const ctx = await bootstrap(config);
  if (!ctx.inferenceEngine) {
    console.error('Error: Inference engine not available');
    await shutdown();
    process.exit(1);
  }

  try {
    const { cmdInfer } = await import('../src/cli/probabilistic-commands.js');
    const result = await cmdInfer(args, config, {
      neuronStore: ctx.neuronStore,
      inferenceEngine: ctx.inferenceEngine,
    });

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      console.log(result.data);
    } else {
      console.error(result.error);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Infer failed:', error.message);
    process.exit(1);
  }
}

async function cmdAttractorDispatch(args: string[], config: Config) {
  if (args.length === 0) {
    console.log('Usage: nmt attractor <subcommand> [options]');
    console.log('Subcommands: create, list, influence, path, activate, deactivate');
    return;
  }

  const ctx = await bootstrap(config);
  if (!ctx.attractorModel) {
    console.error('Error: Attractor model not available');
    await shutdown();
    process.exit(1);
  }

  try {
    const { cmdAttractor } = await import('../src/cli/probabilistic-commands.js');
    const result = await cmdAttractor(args, config, {
      neuronStore: ctx.neuronStore,
      attractorModel: ctx.attractorModel,
    });

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      console.log(result.data);
    } else {
      console.error(result.error);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Attractor failed:', error.message);
    process.exit(1);
  }
}

async function cmdLearnDispatch(args: string[], config: Config) {
  if (args.length === 0) {
    console.log('Usage: nmt learn <subcommand> [options]');
    console.log('Subcommands: interaction, patterns, outcomes, stats');
    return;
  }

  const ctx = await bootstrap(config);
  if (!ctx.learningSystem) {
    console.error('Error: Learning system not available');
    await shutdown();
    process.exit(1);
  }

  try {
    const { cmdLearn } = await import('../src/cli/probabilistic-commands.js');
    const result = await cmdLearn(args, config, {
      neuronStore: ctx.neuronStore,
      learningSystem: ctx.learningSystem,
    });

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      console.log(result.data);
    } else {
      console.error(result.error);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Learn failed:', error.message);
    process.exit(1);
  }
}

async function cmdDimensionDispatch(args: string[], config: Config) {
  if (args.length === 0) {
    console.log('Usage: nmt dimension <subcommand> [options]');
    console.log('Subcommands: list, expand, analyze, stats');
    return;
  }

  const ctx = await bootstrap(config);
  if (!ctx.embeddingManager) {
    console.error('Error: Dynamic embedding manager not available');
    await shutdown();
    process.exit(1);
  }

  try {
    const { cmdDimension } = await import('../src/cli/probabilistic-commands.js');
    const result = await cmdDimension(args, config, {
      neuronStore: ctx.neuronStore,
      embeddingManager: ctx.embeddingManager,
    });

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      console.log(result.data);
    } else {
      console.error(result.error);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Dimension failed:', error.message);
    process.exit(1);
  }
}

async function cmdOrchestrateDispatch(args: string[], config: Config) {
  if (args.length === 0) {
    console.log('Usage: nmt orchestrate <subcommand> [options]');
    console.log('Subcommands: infer, goal, expand, stats');
    return;
  }

  const ctx = await bootstrap(config);

  try {
    const { cmdOrchestrate } = await import('../src/cli/probabilistic-commands.js');
    const result = await cmdOrchestrate(args, config, {
      neuronStore: ctx.neuronStore,
      inferenceEngine: ctx.inferenceEngine,
      attractorModel: ctx.attractorModel,
      learningSystem: ctx.learningSystem,
      neuronManager: ctx.neuronManager,
      embeddingManager: ctx.embeddingManager,
    });

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      console.log(result.data);
    } else {
      console.error(result.error);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Orchestrate failed:', error.message);
    process.exit(1);
  }
}

async function cmdSyncDispatch(args: string[], config: Config) {
  if (args.length === 0) {
    console.log('Usage: nmt sync <subcommand> [options]');
    console.log('Subcommands: status, changes, export, import, peers, journal');
    return;
  }

  const ctx = await bootstrap(config);
  if (!ctx.syncManager) {
    console.error('Error: Sync manager not available');
    await shutdown();
    process.exit(1);
  }

  try {
    const { cmdSync } = await import('../src/cli/probabilistic-commands.js');
    const result = await cmdSync(args, config, {
      neuronStore: ctx.neuronStore,
      syncManager: ctx.syncManager,
      changeJournal: ctx.changeJournal,
    });

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      console.log(result.data);
    } else {
      console.error(result.error);
    }

    await shutdown();
  } catch (error: any) {
    await shutdown();
    console.error('Sync failed:', error.message);
    process.exit(1);
  }
}

// ============== Main Dispatcher ==============

async function main() {
  const { command, args, config } = parseConfig();

  switch (command) {
    // Setup
    case 'init':
      await cmdInit(config);
      break;
    case 'dashboard':
    case 'dash':
      await cmdDashboard(config);
      break;

    // Core DB operations
    case 'ingest':
      await cmdIngest(args, config);
      break;
    case 'ingest-text':
      await cmdIngestText(args, config);
      break;
    case 'search':
      await cmdSearch(args, config);
      break;
    case 'verify':
      await cmdVerify(args, config);
      break;
    case 'list':
    case 'ls':
      await cmdList(config);
      break;
    case 'get':
    case 'show':
      await cmdGet(args, config);
      break;
    case 'stats':
    case 'status':
      await cmdStats(config);
      break;

    // Graph Management
    case 'connect':
      await cmdConnect(args, config);
      break;

    // Benchmarks & Backup
    case 'benchmark':
      await cmdBenchmark(config);
      break;

    // Probabilistic Ontology Commands (확률적 존재론)
    case 'infer':
      await cmdInferDispatch(args, config);
      break;
    case 'attractor':
      await cmdAttractorDispatch(args, config);
      break;
    case 'learn':
      await cmdLearnDispatch(args, config);
      break;
    case 'dimension':
      await cmdDimensionDispatch(args, config);
      break;
    case 'orchestrate':
    case 'orch':
      await cmdOrchestrateDispatch(args, config);
      break;
    case 'sync':
      await cmdSyncDispatch(args, config);
      break;

    // MCP Server (Claude Code Integration)
    case 'mcp':
      await cmdMcp(config);
      break;

    case 'help':
    default:
      console.log(HELP);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
