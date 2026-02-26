<!--
================================================================================
NINEBIX inc.
Email   : sobdi90@9bix.com
Website : https://9bix.com
================================================================================
-->

# NMT System (Neuron Merkle Tree)

**A Probabilistic Ontology-based Verifiable Semantic Knowledge Graph System**

[![npm version](https://img.shields.io/npm/v/@ninebix/nmt-system.svg)](https://www.npmjs.com/package/@ninebix/nmt-system)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-NSAL%20v1.0-orange)](LICENSE)

NMT is a knowledge graph system where **all knowledge exists as probability distributions** rather than deterministic facts. It combines Merkle tree verification, HNSW vector search, and bidirectional inference for building verifiable, distributed knowledge bases.

---

## Features

- **Probabilistic Ontology** - Knowledge as probability distributions, not fixed facts
- **Bidirectional Inference** - Forward (cause→effect) and backward (effect→cause) reasoning
- **Attractor Model** - Goal-oriented decision making with future state influence
- **Four-Stage Learning** - Extract → Pattern → Process → Outcome learning pipeline
- **Merkle Verification** - Cryptographic integrity proofs for all data
- **State Synchronization** - Vector clocks and change journals for distributed systems
- **Dynamic Embeddings** - Runtime-expandable semantic dimensions
- **Local Embeddings** - Powered by Xenova/transformers (no external API required)

---

## Installation

### From npm

```bash
npm install -g @ninebix/nmt-system
```

### From Source

```bash
git clone https://github.com/CopikProjeckId/nmt-system.git
cd nmt-system
npm install
npm run build
npm link
```

---

## Quick Start

### Initialize

```bash
# Initialize data directory
nmt init

# Check system health
nmt prob health
```

### Ingest Data

```bash
# Ingest text file
nmt ingest ./documents/article.txt --tags "ml,tutorial"

# Ingest text directly
nmt ingest-text "Machine learning is a subset of AI" --tags "ml,ai"
```

### Search

```bash
# Semantic search
nmt search "neural networks" --k 10

# Get neuron details
nmt get <neuron-id>
```

### Inference

```bash
# Forward inference (cause → effect)
nmt infer forward <neuron-id> --depth 5

# Backward inference (effect → cause)
nmt infer backward <neuron-id> --depth 5

# Find causal chain between neurons
nmt infer causal <from-id> <to-id>

# Bidirectional inference
nmt infer bidirectional <neuron-id> --depth 3
```

### Attractors (Goal-Oriented Reasoning)

```bash
# Create goal attractor
nmt attractor create "Project Completion" --strength 0.8

# Find path to goal
nmt attractor path <neuron-id> <attractor-id>

# Calculate goal influence on neuron
nmt attractor influence <neuron-id>
```

### Verification

```bash
# Verify neuron integrity
nmt verify neuron <neuron-id>

# Generate Merkle proof
nmt verify proof <neuron-id> --index 2

# Compare two neurons
nmt verify diff <neuron-a> <neuron-b>

# Batch verification
nmt verify batch <neuron-id> --indices 0,2,5
```

### State Synchronization

```bash
# Check sync status
nmt sync status

# View change log
nmt sync changes --from 0

# Export state
nmt sync export --output backup.json

# Import state
nmt sync import backup.json
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          NMT System                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      EventBus                                │   │
│  │   Pub/Sub + Event History + Progress Tracking                │   │
│  └─────────────────────────┬───────────────────────────────────┘   │
│                            │                                        │
│  ┌─────────────────────────┴───────────────────────────────────┐   │
│  │               ProbabilisticOrchestrator                      │   │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │   │
│  │  │Inference│ │Attractor│ │4-Stage   │ │DynamicEmbedding │  │   │
│  │  │Engine   │ │Model    │ │Learning  │ │Manager          │  │   │
│  │  └────┬────┘ └────┬────┘ └────┬─────┘ └────────┬─────────┘  │   │
│  │       └───────────┴───────────┴────────────────┘            │   │
│  │                           │                                  │   │
│  │  ┌────────────────────────┴────────────────────────────┐    │   │
│  │  │          ProbabilisticNeuronManager                  │    │   │
│  │  │    (State Distribution + Probability + Sampling)     │    │   │
│  │  └────────────────────────┬────────────────────────────┘    │   │
│  └───────────────────────────┼──────────────────────────────────┘   │
│                              │                                      │
│  ┌───────────────────────────┴──────────────────────────────────┐  │
│  │                      Core Engines                             │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐              │  │
│  │  │MerkleEngine│  │ HNSWIndex  │  │NeuronGraph │              │  │
│  │  │ (Proofs)   │  │ (Search)   │  │ (Graph)    │              │  │
│  │  └────────────┘  └────────────┘  └────────────┘              │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┴──────────────────────────────────┐  │
│  │                  State Sync Layer                             │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐ │  │
│  │  │VectorClock │  │ChangeJournal │  │StateSyncManager       │ │  │
│  │  └────────────┘  └──────────────┘  └───────────────────────┘ │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┴──────────────────────────────────┐  │
│  │                  Storage Layer (LevelDB)                      │  │
│  │   Chunks | Neurons | Synapses | Index | Journal | State       │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why Probabilistic Ontology?

| Traditional Approach | NMT Probabilistic Approach | Benefit |
|---------------------|---------------------------|---------|
| "A is B" (deterministic) | "A is B with probability 0.85" | Express uncertainty |
| Single answer | Multiple possibility distribution | Reflect complex reality |
| Static knowledge | Context-dependent changes | Dynamic reasoning |
| Cause → Effect only | Cause ↔ Effect bidirectional | Abductive reasoning |

---

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/ingest` | POST | Ingest text content |
| `/api/v1/ingest/url` | POST | Ingest from URL |
| `/api/v1/query/search` | POST | Semantic search |
| `/api/v1/rag/query` | POST | RAG query |
| `/api/v1/graph/neuron/:id` | GET | Get neuron details |
| `/api/v1/graph/full` | GET | Get full graph |
| `/api/v1/health` | GET | Health check |
| `/api/v1/metrics` | GET | System metrics |

### CLI Commands

| Category | Commands |
|----------|----------|
| **Core** | `init`, `ingest`, `search`, `get`, `list`, `stats` |
| **Inference** | `infer forward`, `backward`, `causal`, `bidirectional` |
| **Learning** | `learn extract`, `session` |
| **Attractor** | `attractor create`, `path`, `influence` |
| **Dimension** | `dimension register`, `category`, `set` |
| **Sync** | `sync status`, `changes`, `export`, `import` |
| **Verify** | `verify neuron`, `proof`, `diff`, `batch` |
| **System** | `prob metrics`, `health`, `dashboard` |

---

## Performance

| Metric | Value |
|--------|-------|
| Vector Search (HNSW) | < 10ms for 100K vectors |
| Merkle Proof Generation | < 1ms |
| Batch Proof (100 leaves) | < 5ms |
| Event Publishing | < 100μs |
| State Sync (diff) | O(log n) |

---

## Configuration

Create `.env` file in your project root:

```env
# Data directory for LevelDB storage
DATA_DIR=./data

# Dashboard server port
PORT=3000

# HNSW Index Parameters
HNSW_M=16
HNSW_EF_CONSTRUCTION=200
HNSW_EF_SEARCH=50

# Text Chunking
CHUNK_SIZE=512
CHUNK_OVERLAP=50

# Logging
LOG_LEVEL=info
```

---

## Documentation

- [User Guide (EN)](docs/USER_GUIDE_EN.md)
- [CLI API Reference (EN)](docs/CLI_API_EN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [한국어 문서](docs/README_KO.md)

---

## License

This project is licensed under the [NINEBIX Source Available License (NSAL) v1.0](LICENSE).

**Permitted:**
- View, study, and learn from source code
- Personal/non-commercial use
- Fork with same license (copyleft)

**Commercial use requires separate license.** Contact: sobdi90@9bix.com

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## Acknowledgments

- Built with TypeScript, Express, LevelDB
- Vector search powered by HNSW algorithm
- Embeddings by Xenova/transformers
- Cryptographic hashing via SHA3-256

---

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
