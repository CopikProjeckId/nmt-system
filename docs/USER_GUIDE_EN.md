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
