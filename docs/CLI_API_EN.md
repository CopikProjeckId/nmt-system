# NMT CLI API Reference

Complete documentation for CLI commands and validation schemas.

## Table of Contents

1. [Inference Commands](#inference-commands)
2. [Learning Commands](#learning-commands)
3. [Dimension Commands](#dimension-commands)
4. [Orchestrate Commands](#orchestrate-commands)
5. [Sync Commands](#sync-commands)
6. [Attractor Commands](#attractor-commands)
7. [Verify Commands](#verify-commands)
8. [System Commands](#system-commands)

---

## Inference Commands

### `nmt infer forward`

Forward inference (cause → effect)

```bash
nmt infer forward <neuron-id> [--depth N]
```

**Schema:**
| Parameter | Type | Required | Default | Range | Description |
|-----------|------|----------|---------|-------|-------------|
| neuronId | uuid | ✓ | - | - | Starting neuron ID |
| depth | number | | 3 | 1-10 | Inference depth |

**Example:**
```bash
nmt infer forward neuron-abc123 --depth 5
```

---

### `nmt infer backward`

Backward inference (effect → cause, induction)

```bash
nmt infer backward <neuron-id> [--depth N]
```

**Schema:**
| Parameter | Type | Required | Default | Range | Description |
|-----------|------|----------|---------|-------|-------------|
| neuronId | uuid | ✓ | - | - | Observed neuron ID |
| depth | number | | 3 | 1-10 | Inference depth |

---

### `nmt infer causal`

Explore causal relationship between two neurons

```bash
nmt infer causal <from-id> <to-id>
```

**Schema:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| fromId | uuid | ✓ | Source neuron ID |
| toId | uuid | ✓ | Target neuron ID |

---

### `nmt infer bidirectional`

Bidirectional inference

```bash
nmt infer bidirectional <neuron-id> [--depth N]
```

**Schema:**
| Parameter | Type | Required | Default | Range |
|-----------|------|----------|---------|-------|
| neuronId | uuid | ✓ | - | - |
| depth | number | | 3 | 1-10 |

---

## Learning Commands

### `nmt learn extract`

Extract meaningful content from neuron

```bash
nmt learn extract <neuron-id> [--limit N]
```

**Schema:**
| Parameter | Type | Required | Default | Range | Description |
|-----------|------|----------|---------|-------|-------------|
| neuronId | uuid | ✓ | - | - | Target neuron ID |
| limit | number | | 10 | 1-100 | Result limit |

---

### `nmt learn session`

Manage learning session

```bash
nmt learn session <action>
```

**Schema:**
| Parameter | Type | Required | Allowed Values |
|-----------|------|----------|----------------|
| action | string | ✓ | `start`, `end` |

---

## Dimension Commands

### `nmt dimension register`

Register new dimension

```bash
nmt dimension register <name> [--category "..."] [--description "..."]
```

**Schema:**
| Parameter | Type | Required | Default | Range |
|-----------|------|----------|---------|-------|
| name | string | ✓ | - | 1-100 chars |
| category | string | | "custom" | max 50 chars |
| description | string | | "" | max 500 chars |

---

### `nmt dimension category`

Query dimensions by category

```bash
nmt dimension category <category-name> [--limit N]
```

**Schema:**
| Parameter | Type | Required | Default | Range |
|-----------|------|----------|---------|-------|
| category | string | ✓ | - | 1-50 chars |
| limit | number | | 20 | 1-100 |

---

## Orchestrate Commands

### `nmt orchestrate infer`

Unified inference (all modules combined)

```bash
nmt orchestrate infer <neuron-id> [--depth N] [--no-attractors] [--no-probabilistic]
```

**Schema:**
| Parameter | Type | Required | Default | Range |
|-----------|------|----------|---------|-------|
| neuronId | uuid | ✓ | - | - |
| depth | number | | 3 | 1-10 |
| noAttractors | boolean | | false | - |
| noProbabilistic | boolean | | false | - |

---

### `nmt orchestrate learn`

Interaction learning

```bash
nmt orchestrate learn --input "..." --output "..." [--success] [--feedback N]
```

**Schema:**
| Parameter | Type | Required | Default | Range |
|-----------|------|----------|---------|-------|
| input | string | ✓ | - | min 1 char |
| output | string | ✓ | - | min 1 char |
| success | boolean | | false | - |
| feedback | number | | 0.8/0.2 | 0-1 |
| inputNeuron | uuid | | - | - |
| outputNeuron | uuid | | - | - |

---

### `nmt orchestrate feedback`

Provide feedback

```bash
nmt orchestrate feedback --input-neuron <id> --output-neuron <id> --quality N
```

**Schema:**
| Parameter | Type | Required | Default | Range |
|-----------|------|----------|---------|-------|
| inputNeuron | uuid | ✓ | - | - |
| outputNeuron | uuid | ✓ | - | - |
| quality | number | | 0.5 | 0-1 |
| text | string | | "" | - |

---

### `nmt orchestrate reinforce`

Reinforce successful path

```bash
nmt orchestrate reinforce --from <id> --to <id> [--strength N]
```

**Schema:**
| Parameter | Type | Required | Default | Range |
|-----------|------|----------|---------|-------|
| from | uuid | ✓ | - | - |
| to | uuid | ✓ | - | - |
| strength | number | | 0.1 | 0-1 |

---

## Sync Commands

### `nmt sync status`

Check synchronization status

```bash
nmt sync status [--json]
```

**Output:**
- Node ID
- Current sequence number
- Merkle Root
- Vector Clock
- Last sync time
- Connected peers count

**Example Output:**
```
Sync Status
============================================================

  Node ID:      node-1740612345-a1b2c3d4
  Sequence:     42
  Merkle Root:  abc123def456...
  Last Sync:    2025-02-27T10:30:00Z

  Vector Clock:
    node-1: 42

  Connected Peers: 0
```

---

### `nmt sync changes`

Query change log

```bash
nmt sync changes [--from N] [--limit N]
```

**Schema:**
| Parameter | Type | Required | Default | Range | Description |
|-----------|------|----------|---------|-------|-------------|
| from | number | | 0 | 0+ | Starting sequence |
| limit | number | | 50 | 1-1000 | Max results |

**Example:**
```bash
nmt sync changes --from 10 --limit 100
```

---

### `nmt sync export`

Export state (JSON backup)

```bash
nmt sync export [--output <path>]
```

**Schema:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| output | string | | sync-state.json | Output file path |

**Export Contents:**
- version: File format version
- exportedAt: Export time
- state: Node state (nodeId, sequence, merkleRoot, vectorClock)
- changes: Full change log
- peers: Peer list

---

### `nmt sync import`

Import state (restore)

```bash
nmt sync import <file>
```

**Schema:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| file | string | ✓ | JSON file path (.json extension required) |

**Security:**
- Path traversal attack prevention (sanitized paths)
- Only .json extension allowed

---

### `nmt sync peers`

List connected peers

```bash
nmt sync peers [--json]
```

**Output:**
- Peer ID
- Endpoint (URL)
- Connection status (connected/disconnected)
- Last seen time
- Last sequence

---

### `nmt sync journal`

Journal statistics

```bash
nmt sync journal [--json]
```

**Output:**
- Total entry count
- Oldest sequence
- Latest sequence
- Average entries per minute

---

## Attractor Commands

### `nmt attractor create`

Create goal attractor

```bash
nmt attractor create <name> [--description "..."] [--strength N] [--priority N] [--deadline DATE]
```

**Schema:**
| Parameter | Type | Required | Default | Range | Description |
|-----------|------|----------|---------|-------|-------------|
| name | string | ✓ | - | 1-200 chars | Attractor name |
| description | string | | "" | max 1000 chars | Description |
| strength | number | | 0.5 | 0-1 | Pull strength |
| priority | number | | 5 | 1-10 | Priority |
| deadline | string | | - | ISO 8601 | Deadline |

**Example:**
```bash
nmt attractor create "Project Completion" \
  --description "MVP development and deployment" \
  --strength 0.9 \
  --priority 10 \
  --deadline 2025-03-31
```

---

### `nmt attractor list`

List attractors

```bash
nmt attractor list [--limit N]
```

---

### `nmt attractor path`

Calculate path from current state to goal

```bash
nmt attractor path <neuron-id> <attractor-id>
```

**Schema:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| neuronId | uuid | ✓ | Current state neuron ID |
| attractorId | uuid | ✓ | Goal attractor ID |

**Output:**
- Path probability
- Step-by-step path
- Bottlenecks

---

### `nmt attractor influence`

Query attractor influence on specific neuron

```bash
nmt attractor influence <neuron-id>
```

**Output:**
- Influence score per attractor
- Dominant attractor

---

## Verify Commands

### `nmt verify neuron`

Verify neuron integrity

```bash
nmt verify neuron <neuron-id>
```

**Output:**
- valid: true/false
- merkleRoot: Current Merkle root
- Verification time

---

### `nmt verify proof`

Generate Merkle proof

```bash
nmt verify proof <neuron-id> --index N
```

**Schema:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| neuronId | uuid | ✓ | Neuron ID |
| index | number | ✓ | Leaf index |

---

### `nmt verify batch`

Batch proof (multiple leaves at once)

```bash
nmt verify batch <neuron-id> --indices 0,2,5
```

**Schema:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| neuronId | uuid | ✓ | Neuron ID |
| indices | string | ✓ | Comma-separated indices |

---

### `nmt verify diff`

Compare Merkle tree difference between two neurons

```bash
nmt verify diff <neuron-id-1> <neuron-id-2>
```

**Output:**
- Added hashes
- Removed hashes
- Modified items

---

### `nmt verify range`

Generate range proof

```bash
nmt verify range <neuron-id> --start N --end M
```

**Schema:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| neuronId | uuid | ✓ | - | Neuron ID |
| start | number | ✓ | - | Start index |
| end | number | ✓ | - | End index |

---

## System Commands

### `nmt prob metrics`

Query system metrics

```bash
nmt prob metrics
```

**Output Includes:**
- Uptime, Timestamp
- Counters (request count, learning count, etc.)
- Gauges (active connections, etc.)
- Histograms (latency distribution)
- Health Status

---

### `nmt prob prometheus`

Output metrics in Prometheus format

```bash
nmt prob prometheus
```

---

### `nmt prob health`

System health check

```bash
nmt prob health
```

---

## Validation Errors

When validation fails, errors are returned in this format:

```
Validation Error:
  - field: error message
  - field2: error message
```

### Common Error Types

| Error | Description |
|-------|-------------|
| `is required` | Required parameter missing |
| `must be between X and Y` | Range exceeded |
| `must be one of: [...]` | Enum value mismatch |
| `must be at least N characters` | Minimum length not met |
| `must not exceed N characters` | Maximum length exceeded |
| `must match pattern` | Regex mismatch |

---

*Last Updated: February 2026*
