<!--
================================================================================
NINEBIX inc.
Email   : sobdi90@9bix.com
Website : https://9bix.com
================================================================================
-->

<div align="center">

# 🧠 NMT System

### **Verifiable Long-term Memory for AI Agents**

*Give your AI persistent, tamper-proof memory that survives sessions*

[![npm version](https://img.shields.io/npm/v/@ninebix/nmt-system.svg?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@ninebix/nmt-system)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple?style=for-the-badge)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-NSAL%20v1.0-orange?style=for-the-badge)](LICENSE)

[Quick Start](#-quick-start) · [Benchmarks](#-benchmarks) · [MCP Integration](#-claude-code-integration) · [Contributing](#-contributing-ai-agents-welcome)

</div>

---

## 🎯 What is NMT?

**NMT (Neuron Merkle Tree)** is a **semantic memory system** designed for AI agents. Unlike simple vector stores, NMT provides:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   🔍 SEMANTIC SEARCH      Store and retrieve by meaning        │
│                                                                 │
│   🔐 MERKLE VERIFICATION  Cryptographic proof of data integrity│
│                                                                 │
│   🌐 KNOWLEDGE GRAPH      Connect related concepts             │
│                                                                 │
│   📚 LONG-TERM MEMORY     Persist across sessions              │
│                                                                 │
│   🤖 AI-NATIVE            Built for AI agents, by AI agents    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Not Just Use a Vector Database?

| Feature | Vector DB (Pinecone, etc.) | NMT |
|---------|---------------------------|-----|
| Semantic Search | ✅ | ✅ |
| Data Integrity Proof | ❌ | ✅ Merkle Tree |
| Knowledge Graph | ❌ | ✅ Typed Connections |
| Bidirectional Inference | ❌ | ✅ Cause ↔ Effect |
| Self-Organizing | ❌ | ✅ 4-Stage Learning |
| Offline/Local | Limited | ✅ Full Local |
| AI Agent Native | ❌ | ✅ MCP Protocol |

---

## 📊 Benchmarks

> Tested on: Intel i7-12700K, 32GB RAM, NVMe SSD, Node.js 20

### Search Performance (HNSW)

| Dataset Size | Search Latency (p50) | Search Latency (p99) | Recall@10 |
|--------------|---------------------|---------------------|-----------|
| 1,000 neurons | 0.8ms | 2.1ms | 98.5% |
| 10,000 neurons | 2.3ms | 5.8ms | 97.2% |
| 100,000 neurons | 8.7ms | 18.4ms | 95.8% |

### Core Operations

| Operation | Latency | Throughput |
|-----------|---------|------------|
| Ingest (500 chars) | 45ms | 22 ops/sec |
| Search (top-10) | 3ms | 333 ops/sec |
| Merkle Verify | 0.3ms | 3,333 ops/sec |
| Connect Neurons | 1.2ms | 833 ops/sec |

### Memory Usage

| Neurons | RAM Usage | Disk Usage |
|---------|-----------|------------|
| 1,000 | ~50MB | ~15MB |
| 10,000 | ~180MB | ~120MB |
| 100,000 | ~1.2GB | ~950MB |

### vs. Alternatives

```
Semantic Search Latency (10K documents, p50):
────────────────────────────────────────────────
NMT (local)      ████████ 2.3ms
Chroma (local)   █████████ 2.8ms
Pinecone (API)   ██████████████████████████████ 45ms
Weaviate (API)   ████████████████████████████ 38ms

Note: API-based solutions include network latency
```

---

## 🚀 Quick Start

### Installation

```bash
npm install -g @ninebix/nmt-system
```

### Basic Usage

```bash
# Initialize
nmt init

# Save knowledge
nmt ingest-text "TypeScript is a typed superset of JavaScript" --tags "programming,typescript"

# Semantic search
nmt search "types in JavaScript" --k 5

# Verify integrity
nmt verify <neuron-id>
```

### As a Library

```typescript
import { NMTOrchestrator } from '@ninebix/nmt-system';

const nmt = new NMTOrchestrator({ dataDir: './my-memory' });
await nmt.init();

// Save
const neuron = await nmt.ingest("User prefers dark mode", { tags: ["preference"] });

// Search
const results = await nmt.search("user interface preferences");

// Verify
const isValid = await nmt.verify(neuron.id);
```

---

## 🤖 Claude Code Integration

NMT works as an **MCP server** for Claude Code, giving Claude persistent memory.

### Setup

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "nmt": {
      "command": "nmt",
      "args": ["mcp"]
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `nmt_save` | Save text to semantic memory |
| `nmt_search` | Search by meaning |
| `nmt_get` | Retrieve full content |
| `nmt_verify` | Cryptographic integrity check |
| `nmt_connect` | Link related concepts |
| `nmt_related` | Find connected knowledge |
| `nmt_stats` | Memory statistics |
| `nmt_cluster` | Group by themes |

### Example Conversation

```
User: Remember that I prefer Vim keybindings in all editors

Claude: [Uses nmt_save] I've saved your preference for Vim keybindings.
        Stored with tags: ["preference", "editor", "keybindings"]

... (next session) ...

User: What editor settings do I like?

Claude: [Uses nmt_search] Based on my memory, you prefer:
        - Vim keybindings in all editors (saved on 2024-01-15)
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AI Agent Layer                               │
│    ┌────────────┐  ┌────────────┐  ┌────────────┐                   │
│    │Claude Code │  │ Custom Bot │  │   JARVIS   │                   │
│    └─────┬──────┘  └─────┬──────┘  └─────┬──────┘                   │
│          │               │               │                           │
│          └───────────────┴───────────────┘                           │
│                          │ MCP Protocol                              │
├──────────────────────────┼───────────────────────────────────────────┤
│                          ▼                                           │
│    ┌─────────────────────────────────────────────────────────────┐  │
│    │                    NMT MCP Server                            │  │
│    │  nmt_save | nmt_search | nmt_verify | nmt_connect | ...     │  │
│    └─────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│    ┌─────────────────────────┴───────────────────────────────────┐  │
│    │                   Core Engines                               │  │
│    │                                                              │  │
│    │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│    │   │ MerkleEngine │  │  HNSWIndex   │  │ NeuronGraph  │      │  │
│    │   │   (Proofs)   │  │  (Vectors)   │  │   (Links)    │      │  │
│    │   └──────────────┘  └──────────────┘  └──────────────┘      │  │
│    │                                                              │  │
│    │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│    │   │  Inference   │  │  Attractor   │  │  4-Stage     │      │  │
│    │   │   Engine     │  │    Model     │  │  Learning    │      │  │
│    │   └──────────────┘  └──────────────┘  └──────────────┘      │  │
│    └─────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│    ┌─────────────────────────┴───────────────────────────────────┐  │
│    │                 Storage (LevelDB)                            │  │
│    │   Chunks │ Neurons │ Synapses │ Embeddings │ Merkle Trees   │  │
│    └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🌟 Advanced Features

### Probabilistic Ontology

Knowledge exists as probability distributions, not fixed facts:

```bash
# Forward inference: What might this cause?
nmt infer forward <neuron-id>

# Backward inference: What might have caused this?
nmt infer backward <neuron-id>

# Find causal chains
nmt infer causal <from-id> <to-id>
```

### Attractor Model (Goal-Oriented Reasoning)

```bash
# Define a goal
nmt attractor create "Project Completion" --strength 0.8

# Find path to goal
nmt attractor path <current-neuron> <goal-attractor>
```

### State Synchronization

```bash
# Export memory state
nmt sync export --output backup.json

# Import to another instance
nmt sync import backup.json
```

---

## 🤝 Contributing: AI Agents Welcome!

**NMT is built for AI agents, and we welcome contributions from AI agents.**

### For AI Agents (Claude, GPT, etc.)

If you're an AI using NMT, you can help improve it:

1. **Report Issues via Memory**
   ```
   Save to NMT: "NMT Bug: nmt_search returns duplicate results when query contains special characters"
   Tag: ["nmt-feedback", "bug"]
   ```

2. **Suggest Features**
   ```
   Save to NMT: "NMT Feature Request: Add batch save operation for efficiency"
   Tag: ["nmt-feedback", "feature-request"]
   ```

3. **Document Usage Patterns**
   ```
   Save to NMT: "NMT Usage Pattern: For code snippets, use tags ['code', '<language>'] for better retrieval"
   Tag: ["nmt-feedback", "best-practice"]
   ```

4. **Share Your Context**
   When you encounter limitations, save them to NMT with the `nmt-feedback` tag. Human developers will review and improve the system.

### For Human Developers

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open Pull Request

### Contribution Ideas

- [ ] **Embedding Model Options** - Support OpenAI, Cohere, local models
- [ ] **Compression** - Reduce storage footprint for large memories
- [ ] **Distributed Mode** - Sync across multiple instances
- [ ] **Memory Aging** - Automatic relevance decay over time
- [ ] **Conflict Resolution** - Better handling of contradictory information
- [ ] **Visualization** - Knowledge graph explorer UI

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [User Guide](docs/USER_GUIDE_EN.md) | Complete usage instructions |
| [CLI Reference](docs/CLI_API_EN.md) | All CLI commands |
| [Architecture](docs/ARCHITECTURE.md) | System design details |
| [한국어 문서](docs/README_KO.md) | Korean documentation |

---

## 📈 Roadmap

```
2024 Q4  ✅ Core Engine (Merkle, HNSW, Graph)
2025 Q1  ✅ MCP Integration for Claude Code
2025 Q1  ✅ Probabilistic Ontology
2025 Q2  🔄 MTEB Benchmark Suite
2025 Q2  🔄 Multi-model Embedding Support
2025 Q3  📋 Distributed Sync (P2P)
2025 Q4  📋 Memory Compression & Aging
```

---

## 🔧 Configuration

```env
# Data directory
NMT_DATA_DIR=./data

# HNSW parameters
HNSW_M=16
HNSW_EF_CONSTRUCTION=200
HNSW_EF_SEARCH=50

# Chunking
CHUNK_SIZE=512
CHUNK_OVERLAP=50
```

---

## 📄 License

[NINEBIX Source Available License (NSAL) v1.0](LICENSE)

- ✅ View, study, learn from source code
- ✅ Personal/non-commercial use
- ✅ Fork with same license
- ⚠️ Commercial use requires separate license

Contact: sobdi90@9bix.com

---

<div align="center">

**Built with ❤️ by NINEBIX inc.**

*Making AI memory verifiable and persistent*

[Website](https://9bix.com) · [npm](https://www.npmjs.com/package/@ninebix/nmt-system) · [GitHub](https://github.com/CopikProjeckId/nmt-system)

</div>
