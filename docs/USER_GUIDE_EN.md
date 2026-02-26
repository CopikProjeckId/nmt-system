# NMT System Complete User Guide

> **NMT (Neuron Merkle Tree)** - A Probabilistic Ontology-based Verifiable Semantic Knowledge Graph

---

## Table of Contents

1. [What is NMT?](#1-what-is-nmt)
2. [Installation](#2-installation)
3. [Basic Usage](#3-basic-usage)
4. [Advanced Features - Probabilistic System](#4-advanced-features---probabilistic-system)
5. [State Synchronization](#5-state-synchronization)
6. [Verification and Proofs](#6-verification-and-proofs)
7. [Dashboard](#7-dashboard)
8. [Real-World Scenarios](#8-real-world-scenarios)
9. [Troubleshooting](#9-troubleshooting)
10. [Glossary](#10-glossary)

---

## 1. What is NMT?

### One-Line Description

**NMT** is "a smart database that represents knowledge as probability distributions and provides cryptographic verification."

### Traditional vs NMT Approach

| Traditional Database | NMT |
|---------------------|-----|
| Data has a single value | Data exists as **probability distributions** |
| "Apple = red fruit" | "Apple = red fruit(60%) / company(30%) / green(10%)" |
| Search finds exact matches | Finds **semantically similar** content |
| Can't detect tampering | **Merkle Tree detects tampering instantly** |
| One-way cause→effect | **Bidirectional reasoning** possible |

### 5 Core Concepts

#### 1) Neuron = Knowledge Unit
```
Store text → Creates a "Neuron"
"React is a UI library" → 1 Neuron created
```

#### 2) Synapse = Connection Between Knowledge
```
Semantically similar neurons are auto-connected
"React" ←---connected---→ "Vue" ←---connected---→ "Angular"
```

#### 3) Probability Distribution = Superposition of Possibilities
```
"Bank" neuron = [ "financial institution"(40%) + "river side"(35%) + "verb"(25%) ]
Observation in context collapses to one state
```

#### 4) Attractor = Goals Influence Present
```
Goal: "Master TypeScript"
→ Related learning materials get higher priority
→ Future goals "pull" present decisions
```

#### 5) Merkle Tree = Tamper Prevention
```
Cryptographic "fingerprint" (hash) for all data
Any modification changes the fingerprint → instant detection
```

### Who Can Use This?

| Audience | Use Case |
|----------|----------|
| **Individuals** | Knowledge management, learning records, idea connections |
| **Dev Teams** | Technical doc search, code knowledge base |
| **Researchers** | Paper/resource management, causal analysis |
| **Enterprises** | Internal wiki, AI training data management |
| **Blockchain** | Verifiable data storage, proof generation |

---

## 2. Installation

### Requirements

- **Node.js 18+**: https://nodejs.org
- **Git** (optional): https://git-scm.com

### Installation Steps

```bash
# 1. Clone repository
git clone https://github.com/ninebix/nmt-system.git
cd nmt-system

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Register CLI globally (optional)
npm link

# 5. Environment setup (optional)
cp .env.example .env
# Edit .env file to set API keys
```

### First Run

```bash
# Check system health
nmt prob health

# Help
nmt --help
```

---

## 3. Basic Usage

### 3.1 Data Ingestion

#### CLI Ingestion

```bash
# Direct text ingestion
nmt ingest --text "React is a UI library created by Facebook."

# Ingestion with tags
nmt ingest --text "TypeScript is typed JavaScript." --tags "typescript,frontend"

# From file
nmt ingest --file ./documents/guide.txt
```

#### API Ingestion

```bash
# Text ingestion
curl -X POST http://localhost:3000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "Content to learn", "tags": ["tag1", "tag2"]}'

# URL ingestion
curl -X POST http://localhost:3000/api/v1/ingest/url \
  -d '{"url": "https://example.com/article"}'

# File upload
curl -X POST http://localhost:3000/api/v1/files/ingest \
  -F "file=@./data.xlsx"
```

### 3.2 Search (Query)

#### CLI Search

```bash
# Basic search
nmt query "React state management" --k 5

# Detailed results
nmt query "TypeScript types" --k 10 --verbose
```

#### API Search

```bash
# Semantic search
curl -X POST http://localhost:3000/api/v1/query/search \
  -d '{"query": "search term", "k": 10}'

# RAG search (LLM integration)
curl -X POST http://localhost:3000/api/v1/rag/query \
  -d '{"query": "question", "topK": 5}'
```

### 3.3 Graph Exploration

```bash
# Neuron details
nmt graph neuron <neuron-id>

# Connected neurons
nmt graph connected <neuron-id> --depth 2

# Overall statistics
nmt graph stats
```

---

## 4. Advanced Features - Probabilistic System

### 4.1 Bidirectional Inference

#### Forward Inference (Cause → Effect)

```bash
nmt infer forward <neuron-id> --depth 5

# Example: Starting from "Programming"
# Result: Programming → Python → Machine Learning → Deep Learning → AI
```

**Use Case**: "What can I do if I learn this technology?"

#### Backward Inference (Effect → Cause)

```bash
nmt infer backward <neuron-id> --depth 5

# Example: Backward from "Successful Project"
# Result: Success ← Good Design ← Requirements Analysis ← Customer Understanding
```

**Use Case**: "What do I need to achieve this result?"

#### Causal Relationship Exploration

```bash
nmt infer causal <from-id> <to-id>

# Find causal path between two concepts
```

### 4.2 Attractor Model (Goals)

#### Create Attractor

```bash
# Set goal
nmt attractor create "Project Completion" \
  --description "MVP development and deployment" \
  --priority 9 \
  --deadline 2025-03-31
```

#### Path Calculation

```bash
# Current → Goal path
nmt attractor path <current-neuron> <attractor-id>

# Result:
# Path probability: 0.73
# Steps: Current → Design → Development → Testing → Deployment
# Bottlenecks: [Lack of test automation]
```

#### Influence Query

```bash
nmt attractor influence <neuron-id>

# Which goal has the most influence on current decisions
```

### 4.4 Four-Stage Learning

```
Stage 1: Extract - Identify key content
Stage 2: Pattern - Recognize repeating patterns
Stage 3: Process - Learn AI reasoning process itself
Stage 4: Outcome - Improve through feedback
```

#### Execute Learning

```bash
# Session start
nmt learn session start

# Extract
nmt learn extract <neuron-id> --limit 10

# Integrated learning
nmt orchestrate learn \
  --input "How to manage state in React?" \
  --output "Use useState, Context API" \
  --success \
  --feedback 0.9

# Session end
nmt learn session end
```

### 4.5 Integrated Orchestration

```bash
# Combined inference from all modules
nmt orchestrate infer <neuron-id> --depth 3

# Provide feedback
nmt orchestrate feedback \
  --input-neuron <id> \
  --output-neuron <id> \
  --quality 0.85

# Reinforce successful path
nmt orchestrate reinforce \
  --from <neuron-a> \
  --to <neuron-b> \
  --strength 0.2
```

---

## 5. State Synchronization

### 5.1 Check Sync Status

```bash
nmt sync status

# Output:
# Node ID:      node-abc123
# Sequence:     42
# Merkle Root:  def456...
# Last Sync:    2025-02-27T10:30:00Z
# Vector Clock:
#   node-abc123: 42
# Connected Peers: 1
```

### 5.2 Change Log Query

```bash
# Full change history
nmt sync changes --from 0 --limit 50

# After specific sequence
nmt sync changes --from 35
```

### 5.3 Export/Import State

```bash
# Backup
nmt sync export --output ./backup/state-2025-02-27.json

# Restore
nmt sync import ./backup/state-2025-02-27.json
```

### 5.4 Peer Management

```bash
# Connected peers list
nmt sync peers

# Journal statistics
nmt sync journal
```

---

## 6. Verification and Proofs

### 6.1 Integrity Verification

```bash
# Verify specific neuron
nmt verify neuron <neuron-id>

# Verify entire system
nmt verify all
```

### 6.2 Merkle Proof Generation

```bash
# Single proof
nmt verify proof <neuron-id> --index 2

# Batch proof (multiple at once)
nmt verify batch <neuron-id> --indices 0,2,5

# Range proof
nmt verify range <neuron-id> --start 0 --end 10
```

### 6.3 Compare Two Neurons

```bash
nmt verify diff <neuron-a> <neuron-b>
```

---

## 7. Dashboard

### Run

```bash
cd dashboard
npm install
npm run dev
```

Access http://localhost:5173 in browser

### Pages

| Menu | Function |
|------|----------|
| Dashboard | Overall statistics, recent activity |
| Search | Semantic search, RAG queries |
| Learning | Text/URL ingestion |
| Neurons | Neuron list, details |
| Graph | Knowledge graph visualization |
| Settings | LLM configuration, system settings |

---

## 8. Real-World Scenarios

### Scenario 1: Technical Documentation Knowledge Base

```bash
# 1. Ingest documents
nmt ingest --file ./docs/api-guide.md --tags "api"
nmt ingest --url "https://wiki.company.com/arch"

# 2. Test search
nmt query "deployment process" --k 5

# 3. RAG query
nmt rag "How do I deploy a new service?"
```

### Scenario 2: AI Learning Record

```bash
# 1. Start learning session
nmt learn session start

# 2. Record reasoning process
nmt orchestrate learn \
  --input "Code optimization request" \
  --output "Applied caching, improved algorithms" \
  --success \
  --feedback 0.85

# 3. End session
nmt learn session end
```

### Scenario 3: Decision Support

```bash
# 1. Set goal
nmt attractor create "Revenue Growth" --priority 10

# 2. Analyze current situation
nmt infer forward <current-situation-neuron>

# 3. Path to goal
nmt attractor path <current> <goal>
```

---

## 9. Troubleshooting

### "Neuron not found"

```bash
# Check neuron list
nmt graph list --limit 10
```

### "EBUSY: resource busy or locked"

DB file lock issue on Windows. Auto-retry after brief wait.

### "Validation Error"

```bash
# Check parameter ranges
nmt <command> --help
```

### Server Won't Start

```bash
# Kill existing processes
taskkill /F /IM node.exe  # Windows
pkill node                 # Mac/Linux

# Delete data folder (resets data)
rm -rf data

# Restart
npm run dev
```

---

## 10. Glossary

| Term | Description |
|------|-------------|
| Neuron | Single unit of stored knowledge |
| Synapse | Connection between neurons |
| Embedding | Text converted to number vector |
| Merkle Tree | Hash tree for integrity verification |
| Attractor | Future goal state |
| Superposition | Simultaneous existence of multiple states |
| Observation | Collapsing to single state |
| Entanglement | Correlation between two neurons |
| Vector Clock | Distributed causality tracking |
| HNSW | High-speed vector search algorithm |

---

## Appendix: Quick Command Reference

### Essential

```bash
nmt prob health              # System health
nmt ingest --text "..."      # Text ingestion
nmt query "..."              # Search
nmt sync status              # Sync status
```

### Inference

```bash
nmt infer forward <id>       # Forward inference
nmt infer backward <id>      # Backward inference
nmt infer causal <a> <b>     # Causal relationship
```

### Attractor

```bash
nmt attractor create "..."   # Create goal
nmt attractor path <a> <b>   # Calculate path
nmt attractor influence <id> # Query influence
```

### Management

```bash
nmt sync export              # Export state
nmt sync import <file>       # Import state
nmt verify neuron <id>       # Verify integrity
nmt prob metrics             # View metrics
```

---

*Last Updated: February 2026*

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
