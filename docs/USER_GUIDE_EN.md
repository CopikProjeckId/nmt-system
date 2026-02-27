# NMT System User Guide

## Introduction

NMT is a probabilistic knowledge graph where knowledge exists as probability distributions.

**Key Features:**
- Uncertainty representation
- Bidirectional reasoning
- Goal-oriented decisions
- Cryptographic verification

---

## Installation

```bash
npm install -g @ninebix/nmt-system
```

---

## Getting Started

```bash
# Initialize
nmt init

# Ingest content
nmt ingest ./document.txt --tags "topic1,topic2"

# Search
nmt search "your query" --k 10

# Check status
nmt stats
```

---

## Core Concepts

### Neurons
Fundamental knowledge units with probability distributions.

### Synapses
Weighted connections between neurons.

### Merkle Trees
Cryptographic integrity verification.

---

## Inference

```bash
# Forward (cause → effect)
nmt infer forward <neuron-id> --depth 5

# Backward (effect → cause)
nmt infer backward <neuron-id> --depth 5

# Causal chain
nmt infer causal <from-id> <to-id>
```

---

## Attractors

Goal states that influence current decisions.

```bash
nmt attractor create "Goal" --strength 0.8
nmt attractor path <neuron-id> <attractor-id>
```

---

## Learning

Four-stage pipeline: Extract → Pattern → Process → Outcome

```bash
nmt learn extract <neuron-id>
nmt orchestrate learn --input "Q" --output "A" --success
```

---

## Verification

```bash
nmt verify neuron <neuron-id>
nmt verify proof <neuron-id> --index 2
```

---

## DB Bridge — External Database Integration

Import data from MySQL/MariaDB/MongoDB into NMT and export back with 100% DDL fidelity.

### Supported Databases

| DB | Driver | Package |
|----|--------|---------|
| MySQL | `mysql` | `npm install mysql2` |
| MariaDB | `mariadb` | `npm install mysql2` |
| MongoDB | `mongodb` | `npm install mongodb` |

### Connect

```bash
curl -X POST http://localhost:3000/api/v1/db/connect \
  -H "Content-Type: application/json" \
  -d '{"driver": "mysql", "host": "localhost", "database": "mydb", "user": "root", "password": "pass"}'
```

### Import (DB → NMT)

```bash
curl -X POST http://localhost:3000/api/v1/db/import \
  -d '{"table": "users", "limit": 5000}'
```

Each row becomes a neuron. Original data (column values, DDL structure) is preserved in metadata.

### Export (NMT → DB)

```bash
curl -X POST http://localhost:3000/api/v1/db/export \
  -d '{"tags": ["db-import", "users"], "restoreSourceData": true}'
```

With `restoreSourceData: true`, the original column types, foreign keys, indexes, CHECK constraints, triggers, and engine settings are fully restored.

---

## Configuration

```env
DATA_DIR=./data
PORT=3000
HNSW_M=16
HNSW_EF_CONSTRUCTION=200
HNSW_EF_SEARCH=50
CHUNK_SIZE=512
LOG_LEVEL=info
```

---

## Best Practices

1. Use meaningful tags
2. Start with depth 3 for inference
3. Verify important data
4. Backup regularly with sync export

---

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
