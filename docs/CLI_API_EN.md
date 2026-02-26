# NMT CLI API Reference

## Global Options

```bash
nmt [command] [options]

Options:
  -h, --help        Show help
  -v, --version     Show version
  -d, --data-dir    Data directory (default: ./data)
  --json            Output as JSON
```

---

## Core Commands

### init
Initialize data directory.
```bash
nmt init
```

### ingest
Ingest text file.
```bash
nmt ingest <file> --tags "tag1,tag2"
```

### search
Semantic search.
```bash
nmt search <query> --k 10 --content
```

### get / list / stats
```bash
nmt get <neuron-id>
nmt list --limit 20
nmt stats
```

---

## Inference Commands

```bash
nmt infer forward <neuron-id> --depth 5
nmt infer backward <neuron-id> --depth 5
nmt infer causal <from-id> <to-id>
nmt infer bidirectional <neuron-id> --depth 3
```

---

## Attractor Commands

```bash
nmt attractor create <name> --strength 0.8 --priority 9
nmt attractor list
nmt attractor path <neuron-id> <attractor-id>
nmt attractor influence <neuron-id>
```

---

## Learning Commands

```bash
nmt learn session start|end|stats
nmt learn extract <neuron-id> --limit 10
```

---

## Verification Commands

```bash
nmt verify neuron <neuron-id>
nmt verify proof <neuron-id> --index 2
nmt verify diff <neuron-a> <neuron-b>
nmt verify batch <neuron-id> --indices 0,2,5
```

---

## Sync Commands

```bash
nmt sync status
nmt sync changes --from 0 --limit 50
nmt sync export --output backup.json
nmt sync import backup.json
nmt sync peers
```

---

## System Commands

```bash
nmt prob health
nmt prob metrics
nmt dashboard --port 3000
nmt benchmark
```

---

## Orchestration Commands

```bash
nmt orchestrate infer <input> --depth 3
nmt orchestrate learn --input "Q" --output "A" --success --feedback 0.9
nmt orchestrate feedback <neuron-id> --score 0.8
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| NMT_DATA_DIR | ./data | Data directory |
| PORT | 3000 | Dashboard port |
| LOG_LEVEL | info | Logging level |

---

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
