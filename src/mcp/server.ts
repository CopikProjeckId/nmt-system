/**
 * NMT MCP Server
 * Model Context Protocol server for NMT system
 *
 * @module mcp/server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ============================================================
// NMT System Instructions for AI Agents
// ============================================================
const NMT_SYSTEM_INSTRUCTIONS = `
# NMT (Neuron Merkle Tree) - Persistent Semantic Memory

## ⚡ MANDATORY: Session Start Protocol

**AT THE VERY BEGINNING OF EVERY CONVERSATION, before anything else:**
1. Call nmt_session_start — loads stored memory context automatically
2. Read the returned context block and use it to inform your responses

This is non-negotiable. Without this step, you are operating without memory.

## When to Save (nmt_save)

- User shares preferences, decisions, or project context worth keeping
- You learn something important about the user's workflow, codebase, or goals
- A significant architectural or design decision is made
- User explicitly says "remember this" / "save this"

Do NOT save: passwords, API keys, temporary info, trivial one-off facts.

## When to Search (nmt_search)

- Before answering questions about past context
- When starting work on a familiar project (supplement nmt_session_start)
- When session_start context seems incomplete for the current task

## Workflow Patterns

Starting a session (MANDATORY):
  nmt_session_start()  →  loads recent memory context

Saving new knowledge:
  nmt_save(text="...", tags=["project-x", "architecture"])

Focused recall:
  nmt_search(query="authentication decisions for project-x")

Building connections:
  nmt_connect(sourceId, targetId, type="causal")

## Tagging Convention
- Project scope: ["project-x"]
- Decision type: ["architecture", "preference", "bug-fix", "decision"]
- Domain: ["auth", "ui", "db", "api"]
`.trim();

import { ChunkEngine } from '../core/chunk-engine.js';
import { MerkleEngine } from '../core/merkle-engine.js';
import { HNSWIndex } from '../core/hnsw-index.js';
import { NeuronGraphManager } from '../core/neuron-graph.js';
import { ChunkStore } from '../storage/chunk-store.js';
import { NeuronStore } from '../storage/neuron-store.js';
import { IndexStore } from '../storage/index-store.js';
import { IngestionService } from '../services/ingestion.js';
import { QueryService } from '../services/query.js';
import { VerificationService } from '../services/verify.js';
import { ClusteringService } from '../extensions/clustering/index.js';
import { ContextBuilder } from '../services/context-builder.js';

/**
 * NMT MCP Server
 */
export class NMTMCPServer {
  private server: Server;
  private dataDir: string;

  // Core components
  private chunkEngine!: ChunkEngine;
  private merkleEngine!: MerkleEngine;
  private hnswIndex!: HNSWIndex;
  private chunkStore!: ChunkStore;
  private neuronStore!: NeuronStore;
  private indexStore!: IndexStore;
  private graphManager!: NeuronGraphManager;
  private ingestionService!: IngestionService;
  private queryService!: QueryService;
  private verifyService!: VerificationService;
  private clusteringService!: ClusteringService;
  private contextBuilder!: ContextBuilder;

  private initialized = false;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;

    this.server = new Server(
      {
        name: 'nmt-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        instructions: NMT_SYSTEM_INSTRUCTIONS,
      }
    );

    this.setupHandlers();
  }

  /**
   * Initialize all components
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.chunkEngine = new ChunkEngine();
    this.merkleEngine = new MerkleEngine();
    this.hnswIndex = new HNSWIndex();

    this.chunkStore = new ChunkStore({ dataDir: this.dataDir });
    this.neuronStore = new NeuronStore({ dataDir: this.dataDir });
    this.indexStore = new IndexStore({ dataDir: this.dataDir });

    try {
      await this.chunkStore.init();
      await this.neuronStore.init();
      await this.indexStore.init();
    } catch (err: any) {
      throw new Error(
        `Failed to open database at "${this.dataDir}": ${err.message}\n` +
        `  Run "nmt init" to initialize the data directory first.`
      );
    }

    const existingIndex = await this.indexStore.load('main');
    if (existingIndex) {
      this.hnswIndex = existingIndex;
    }

    this.graphManager = new NeuronGraphManager({
      neuronStore: this.neuronStore,
      hnswIndex: this.hnswIndex,
    });

    this.ingestionService = new IngestionService(
      this.chunkEngine,
      this.merkleEngine,
      this.graphManager,
      this.chunkStore
    );

    this.queryService = new QueryService(
      this.graphManager,
      this.merkleEngine,
      this.chunkStore,
      this.neuronStore
    );

    this.verifyService = new VerificationService(
      this.merkleEngine,
      this.chunkStore,
      this.neuronStore
    );

    this.clusteringService = new ClusteringService(this.neuronStore);

    this.contextBuilder = new ContextBuilder({
      neuronStore: this.neuronStore,
      chunkStore: this.chunkStore,
    });

    this.initialized = true;
  }

  /**
   * Setup MCP handlers
   */
  private setupHandlers(): void {
    // List prompts - provides system instructions and usage guides
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'nmt_guide',
          description: 'Complete guide for using NMT memory system effectively',
        },
        {
          name: 'nmt_quick_start',
          description: 'Quick start: basic save and search operations',
        },
      ],
    }));

    // Get prompt content
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name } = request.params;

      if (name === 'nmt_guide') {
        return {
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: NMT_SYSTEM_INSTRUCTIONS },
            },
          ],
        };
      }

      if (name === 'nmt_quick_start') {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `NMT Quick Start:
1. Save: nmt_save(text="important info", tags=["category"])
2. Search: nmt_search(query="what I saved about...")
3. Get full content: nmt_get(neuronId="...")
4. Verify integrity: nmt_verify(neuronId="...")`,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${name}`);
    });

    // List available tools with comprehensive descriptions
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'nmt_session_start',
          description: `⚡ CALL THIS FIRST at the start of EVERY conversation.
Loads your persistent memory context from NMT storage — recent decisions, preferences, and project knowledge.
Returns a formatted context block. Read it and use it to inform all subsequent responses.
No arguments needed. Fast (~5ms, no embedding required).`,
          inputSchema: {
            type: 'object',
            properties: {
              recentN: {
                type: 'number',
                description: 'How many recent memories to include (default: 15)',
              },
            },
          },
        },
        {
          name: 'nmt_save',
          description: `Save text to persistent semantic memory. Use when:
- User says "remember this", "save for later", "keep this in mind"
- You learn important user preferences, decisions, or context
- User shares documents, code, or knowledge worth preserving
Returns a neuronId for future reference. Tags help with organization.
Example: nmt_save(text="User prefers TypeScript over JavaScript", tags=["preference", "coding"])`,
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'The text content to save. Can be any length - will be chunked automatically.',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Categorical tags for organization. Examples: ["project-x", "architecture"], ["user-preference", "ui"]',
              },
            },
            required: ['text'],
          },
        },
        {
          name: 'nmt_search',
          description: `Semantic search across all stored memories. Use when:
- User asks "do you remember...", "what did I tell you about..."
- You need to recall past conversations or stored knowledge
- Looking for related information before making decisions
Searches by MEANING, not keywords. "coding preferences" finds "programming style choices".
Example: nmt_search(query="user's favorite programming language", limit=5)`,
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Semantic search query. Describe what you are looking for by meaning, not exact words.',
              },
              limit: {
                type: 'number',
                description: 'Maximum results to return (default: 10). Use lower values for focused searches.',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'nmt_get',
          description: `Retrieve full content of a specific neuron by ID. Use after nmt_search to get complete text when the search result snippet is insufficient.
Example: nmt_get(neuronId="abc-123-def")`,
          inputSchema: {
            type: 'object',
            properties: {
              neuronId: {
                type: 'string',
                description: 'The neuron ID returned from nmt_save or nmt_search',
              },
            },
            required: ['neuronId'],
          },
        },
        {
          name: 'nmt_verify',
          description: `Cryptographically verify data integrity using Merkle tree proofs. Use when:
- Data accuracy is critical (legal, financial, security contexts)
- User questions if stored data was modified
- Auditing or compliance requirements
Returns valid:true if data is untampered.
Example: nmt_verify(neuronId="abc-123-def")`,
          inputSchema: {
            type: 'object',
            properties: {
              neuronId: {
                type: 'string',
                description: 'The neuron ID to verify for tampering',
              },
            },
            required: ['neuronId'],
          },
        },
        {
          name: 'nmt_connect',
          description: `Create explicit connections between neurons to build a knowledge graph. Connection types:
- semantic: conceptually related (e.g., "TypeScript" ↔ "JavaScript")
- reference: one cites/mentions the other
- temporal: time-based sequence (before/after)
- causal: cause and effect relationship
Example: nmt_connect(sourceId="abc", targetId="def", type="causal")`,
          inputSchema: {
            type: 'object',
            properties: {
              sourceId: {
                type: 'string',
                description: 'Source neuron ID (the "from" node)',
              },
              targetId: {
                type: 'string',
                description: 'Target neuron ID (the "to" node)',
              },
              type: {
                type: 'string',
                enum: ['semantic', 'reference', 'temporal', 'causal'],
                description: 'The type of relationship between neurons',
              },
            },
            required: ['sourceId', 'targetId', 'type'],
          },
        },
        {
          name: 'nmt_related',
          description: `Find neurons semantically related to a given neuron. Useful for exploring the knowledge graph and discovering connections.
Example: nmt_related(neuronId="abc-123", depth=2)`,
          inputSchema: {
            type: 'object',
            properties: {
              neuronId: {
                type: 'string',
                description: 'The neuron ID to find related content for',
              },
              depth: {
                type: 'number',
                description: 'How many connection hops to traverse (default: 2)',
              },
            },
            required: ['neuronId'],
          },
        },
        {
          name: 'nmt_stats',
          description: `Get current NMT system statistics including neuron count, connections, and storage usage. Useful for monitoring memory growth.
Example: nmt_stats()`,
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'nmt_cluster',
          description: `Group neurons into semantic clusters using K-means. Useful for:
- Discovering themes in stored knowledge
- Organizing large amounts of information
- Finding unexpected connections
Example: nmt_cluster(k=5) groups all neurons into 5 semantic clusters`,
          inputSchema: {
            type: 'object',
            properties: {
              k: {
                type: 'number',
                description: 'Number of clusters to create. Start with 3-5 for small datasets.',
              },
            },
            required: ['k'],
          },
        },
      ],
    }));

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'nmt://context',
          name: 'NMT Memory Context',
          description: 'Formatted memory context for session injection — recent and frequently accessed memories with content preview',
          mimeType: 'text/plain',
        },
        {
          uri: 'nmt://stats',
          name: 'NMT Statistics',
          description: '현재 NMT 시스템 통계',
          mimeType: 'application/json',
        },
        {
          uri: 'nmt://neurons',
          name: 'Recent Neurons',
          description: '최근 저장된 뉴런 목록',
          mimeType: 'application/json',
        },
      ],
    }));

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      await this.init();
      const uri = request.params.uri;

      if (uri === 'nmt://context') {
        const ctx = await this.contextBuilder.build({ recentN: 15, topN: 5 });
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: ctx.text,
            },
          ],
        };
      }

      if (uri === 'nmt://stats') {
        const graphStats = await this.graphManager.getStats();
        const chunkStats = await this.chunkStore.getStats();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                neurons: graphStats.neuronCount,
                synapses: graphStats.synapseCount,
                chunks: chunkStats.totalChunks,
                totalSize: chunkStats.totalSize,
              }, null, 2),
            },
          ],
        };
      }

      if (uri === 'nmt://neurons') {
        const neurons = await this.queryService.getRecentlyAccessed(20);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                neurons.map((n) => ({
                  id: n.id,
                  tags: n.metadata.tags,
                  createdAt: n.metadata.createdAt,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.init();
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'nmt_session_start': {
            const { recentN = 15 } = (args ?? {}) as { recentN?: number };
            const ctx = await this.contextBuilder.build({ recentN, topN: 5 });
            return {
              content: [
                {
                  type: 'text',
                  text: ctx.text,
                },
              ],
            };
          }

          case 'nmt_save': {
            const { text, tags } = args as { text: string; tags?: string[] };
            const neuron = await this.ingestionService.ingestText(text, {
              tags,
              autoConnect: true,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    neuronId: neuron.id,
                    merkleRoot: neuron.merkleRoot,
                    message: `텍스트가 저장되었습니다. ID: ${neuron.id}`,
                  }),
                },
              ],
            };
          }

          case 'nmt_search': {
            const { query, limit = 10 } = args as { query: string; limit?: number };
            const results = await this.queryService.search(query, {
              k: limit,
              includeContent: true,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    count: results.length,
                    results: results.map((r) => ({
                      id: r.neuron.id,
                      score: r.score,
                      content: r.content,
                      tags: r.neuron.metadata.tags,
                    })),
                  }),
                },
              ],
            };
          }

          case 'nmt_get': {
            const { neuronId } = args as { neuronId: string };
            const neuron = await this.queryService.getNeuron(neuronId);
            if (!neuron) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'Neuron not found' }) }],
              };
            }
            const content = await this.queryService.getContent(neuron);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    id: neuron.id,
                    content,
                    tags: neuron.metadata.tags,
                    merkleRoot: neuron.merkleRoot,
                    createdAt: neuron.metadata.createdAt,
                  }),
                },
              ],
            };
          }

          case 'nmt_verify': {
            const { neuronId } = args as { neuronId: string };
            const result = await this.verifyService.verifyNeuron(neuronId);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    valid: result.valid,
                    neuronId: result.neuronId,
                    message: result.valid
                      ? '데이터가 검증되었습니다. 위변조되지 않았습니다.'
                      : '경고: 데이터가 변조되었을 수 있습니다!',
                  }),
                },
              ],
            };
          }

          case 'nmt_connect': {
            const { sourceId, targetId, type } = args as {
              sourceId: string;
              targetId: string;
              type: string;
            };
            const synapse = await this.graphManager.connect(sourceId, targetId, type as any);
            if (!synapse) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to connect' }) }],
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    synapseId: synapse.id,
                    message: `뉴런이 연결되었습니다.`,
                  }),
                },
              ],
            };
          }

          case 'nmt_related': {
            const { neuronId, depth = 2 } = args as { neuronId: string; depth?: number };
            // depth used to scale result count (more depth = more results to explore)
            const results = await this.queryService.searchSimilarTo(neuronId, { k: 5 * depth });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    count: results.length,
                    related: results.map((r) => ({
                      id: r.neuron.id,
                      score: r.score,
                      tags: r.neuron.metadata.tags,
                    })),
                  }),
                },
              ],
            };
          }

          case 'nmt_stats': {
            const graphStats = await this.graphManager.getStats();
            const chunkStats = await this.chunkStore.getStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    neurons: graphStats.neuronCount,
                    synapses: graphStats.synapseCount,
                    chunks: chunkStats.totalChunks,
                    totalSize: chunkStats.totalSize,
                    indexNodes: graphStats.indexStats.totalNodes,
                  }),
                },
              ],
            };
          }

          case 'nmt_cluster': {
            const { k } = args as { k: number };
            const result = await this.clusteringService.kmeans({ k });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    clusterCount: result.clusters.length,
                    silhouetteScore: result.silhouetteScore,
                    clusters: result.clusters.map((c) => ({
                      id: c.id,
                      memberCount: c.members.length,
                      avgSimilarity: c.avgSimilarity,
                    })),
                  }),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
        };
      }
    });
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    await this.init();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('NMT MCP Server running on stdio');
  }

  /**
   * Close the server
   */
  async close(): Promise<void> {
    try { await this.indexStore.save('main', this.hnswIndex); } catch { /* ignore */ }
    try { await this.chunkStore.close(); } catch { /* ignore */ }
    try { await this.neuronStore.close(); } catch { /* ignore */ }
    try { await this.indexStore.close(); } catch { /* ignore */ }
  }
}

// Auto-start only when run directly (not imported)
// Check if this module is the main entry point
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
                     process.argv[1]?.endsWith('server.js') ||
                     process.argv[1]?.endsWith('server.ts');

if (isMainModule) {
  const server = new NMTMCPServer(process.env.NMT_DATA_DIR || './data');

  server.start().catch((error) => {
    console.error('Failed to start NMT MCP Server:', error);
    process.exit(1);
  });

  // Handle shutdown signals
  const gracefulShutdown = async (signal: string) => {
    console.error(`\n[nmt-mcp] ${signal} received, closing...`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT',  () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

  // Guard against uncaught errors — always clean up DB before exit
  process.on('uncaughtException', async (err) => {
    console.error('[nmt-mcp] Fatal error:', err.message);
    await server.close();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[nmt-mcp] Unhandled async error:', msg);
    await server.close();
    process.exit(1);
  });
}
