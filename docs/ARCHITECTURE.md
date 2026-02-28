# NMT System Architecture

**Technical Architecture Documentation**

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Components](#core-components)
3. [Data Flow](#data-flow)
4. [Storage Architecture](#storage-architecture)
5. [Event System](#event-system)
6. [Synchronization Layer](#synchronization-layer)
7. [Security Considerations](#security-considerations)
8. [Performance Optimization](#performance-optimization)

---

## System Overview

NMT (Neuron Merkle Tree)는 **확률적 존재론(Probabilistic Ontology)** 기반의 지식 그래프 시스템입니다.

### Design Principles

1. **Probabilistic by Default**: 모든 지식은 확률 분포로 표현
2. **Verifiable**: Merkle Tree로 모든 데이터 무결성 검증 가능
3. **Distributed-Ready**: Vector Clock 기반 동기화로 분산 환경 지원
4. **Event-Driven**: 느슨한 결합을 위한 Pub/Sub 아키텍처
5. **Extensible**: 동적 차원 추가로 유연한 임베딩 확장

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   CLI       │  │  REST API   │  │  Dashboard  │  │  MCP Server │     │
│  │  (bin/nmt)  │  │  (Express)  │  │   (React)   │  │  (stdio)    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
└─────────┼────────────────┼────────────────┼────────────────┼────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
┌───────────────────────────────────┼──────────────────────────────────────┐
│                           Service Layer                                   │
│                                   │                                       │
│  ┌────────────────────────────────┴────────────────────────────────────┐ │
│  │                    ProbabilisticOrchestrator                         │ │
│  │   Coordinates: Inference + Attractor + Learning + Neuron + Embedding │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │ Ingestion    │ │ Query        │ │ Embedding    │ │ Four-Stage   │    │
│  │ Service      │ │ Service      │ │ Provider     │ │ Learning     │    │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘    │
│                                                                           │
│  ┌──────────────┐ ┌──────────────────────────────────────────────────┐  │
│  │ DB Bridge    │ │ DB Connectors (MySQL/MariaDB, MongoDB)           │  │
│  │ Service      │◀▶│ SQL ↔ NMT round-trip with full DDL fidelity    │  │
│  └──────────────┘ └──────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼──────────────────────────────────────┐
│                            Core Layer                                     │
│                                   │                                       │
│  ┌──────────────────────┬─────────┴─────────┬──────────────────────┐    │
│  │                      │                   │                       │    │
│  ▼                      ▼                   ▼                       ▼    │
│ ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐       │
│ │Bidirectional│  │ Attractor  │   │Probabilistic│  │  Dynamic   │       │
│ │ Inference  │   │   Model    │   │   Neuron   │   │ Embedding  │       │
│ └────────────┘   └────────────┘   └────────────┘   └────────────┘       │
│                                                                          │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐      │
│  │  Merkle    │   │   HNSW     │   │  Neuron    │   │ Evolution  │      │
│  │  Engine    │   │   Index    │   │   Graph    │   │ Scheduler  │      │
│  └────────────┘   └────────────┘   └────────────┘   └────────────┘      │
└───────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼──────────────────────────────────────┐
│                         Infrastructure Layer                              │
│                                   │                                       │
│  ┌──────────────────────┬─────────┴─────────┬──────────────────────┐    │
│  │                      │                   │                       │    │
│  ▼                      ▼                   ▼                       ▼    │
│ ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐       │
│ │  EventBus  │   │ StateSync  │   │  Progress  │   │  Metrics   │       │
│ │            │   │  Manager   │   │  Tracker   │   │            │       │
│ └────────────┘   └────────────┘   └────────────┘   └────────────┘       │
│                         │                                                │
│                         ▼                                                │
│              ┌────────────────────┐                                      │
│              │   ChangeJournal    │                                      │
│              │   + VectorClock    │                                      │
│              └────────────────────┘                                      │
└───────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼──────────────────────────────────────┐
│                          Storage Layer                                    │
│                                   │                                       │
│                    ┌──────────────┴──────────────┐                       │
│                    │     ProbabilisticStore      │                       │
│                    │       (LevelDB)             │                       │
│                    └──────────────┬──────────────┘                       │
│                                   │                                       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  │
│  │  Chunks   │ │  Neurons  │ │ Synapses  │ │   Index   │ │  Journal  │  │
│  │  Store    │ │   Store   │ │   Store   │ │   Store   │ │   Store   │  │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. ProbabilisticOrchestrator

**역할**: 모든 확률적 모듈의 통합 조정

```typescript
interface OrchestratorConfig {
  autoSaveInterval: number;       // 자동 저장 간격 (기본: 5분)
  enableAutoEvolution: boolean;   // 자동 진화 활성화
  enableAutoSave: boolean;        // 자동 저장 활성화
  neuronEvolveInterval: number;   // 뉴런 진화 간격 (기본: 1분)
  attractorDecayInterval: number; // 끌개 감쇠 간격 (기본: 1시간)
}
```

**주요 기능**:
- 통합 추론 (Unified Inference)
- 상호작용 학습 (Interaction Learning)
- 피드백 처리 (Feedback Processing)
- 성공 경로 강화 (Path Reinforcement)
- 상태 자동 저장/복원

### 2. BidirectionalInferenceEngine

**역할**: 원인↔결과 양방향 추론

```typescript
// 순방향 추론 (연역)
forwardInference(startNeuronId: UUID, depth: number): Promise<InferenceResult>

// 역방향 추론 (귀납)
backwardInference(observedNeuronId: UUID, depth: number): Promise<InferenceResult>

// 인과 경로 탐색
findCausalPath(fromId: UUID, toId: UUID): Promise<CausalPath[]>
```

**알고리즘**:
1. BFS/DFS 기반 그래프 탐색
2. 시냅스 가중치에 따른 신뢰도 감쇠
3. 순환 감지 및 방지
4. 경로 확률 계산

### 3. AttractorModel

**역할**: 목표 기반 확률 조향

```typescript
interface Attractor {
  id: UUID;
  name: string;
  embedding: Embedding384;
  strength: number;        // 끌어당기는 힘 (0-1)
  probability: number;     // 도달 확률 (0-1)
  priority: number;        // 우선순위 (1-10)
  deadline?: string;       // 마감일
  prerequisites: UUID[];   // 선행 조건
}
```

**핵심 개념**:
- **확률장 (Probability Field)**: 끌개 주변의 확률 그래디언트
- **경로 확률 (Path Probability)**: 현재 상태에서 끌개까지의 도달 확률
- **영향력 (Influence)**: 끌개가 현재 결정에 미치는 영향

### 4. ProbabilisticNeuronManager

**역할**: 확률적 뉴런 상태 관리

```typescript
interface NeuronState {
  index: number;
  probability: number;      // 직접 확률 (0-1)
  embedding: Embedding384;  // 상태별 임베딩
  label?: string;
}

interface SuperpositionState {
  neuronId: UUID;
  states: NeuronState[];
  entropy: number;          // Shannon entropy
  observedAt?: string;
  collapsedState?: number;
}
```

**주요 연산**:
- `createProbabilisticNeuron()`: 확률적 뉴런 생성
- `observe()`: 상태 관측 (확률적 선택)
- `updateProbabilities()`: 확률 분포 업데이트
- `correlate()`: 두 뉴런 상관관계 설정

### 5. DynamicEmbeddingManager

**역할**: 동적 차원 관리

```typescript
interface DynamicDimension {
  id: UUID;
  name: string;
  category: string;
  description: string;
  weight: number;           // 차원 가중치
  createdAt: string;
}
```

**특징**:
- 런타임 차원 추가/제거
- 카테고리별 차원 그룹화
- 차원별 가중치 조절

### 6. FourStageLearningSystem

**역할**: 4단계 구조화 학습

```
┌─────────────────────────────────────────────────────────────┐
│                    Four-Stage Learning                       │
│                                                              │
│  Stage 1: Extract (추출)                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Input Text → Keywords → Importance Score → Extract   │    │
│  └─────────────────────────────────────────────────────┘    │
│                           ↓                                  │
│  Stage 2: Pattern (패턴)                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Extracts → Clustering → Centroid → LearnedPattern    │    │
│  └─────────────────────────────────────────────────────┘    │
│                           ↓                                  │
│  Stage 3: Process (과정)                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ AI Steps → Reasoning Chain → Success Rate → Process  │    │
│  └─────────────────────────────────────────────────────┘    │
│                           ↓                                  │
│  Stage 4: Outcome (결과)                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Result → Feedback → Quality Score → Outcome Record   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 7. MerkleEngine

**역할**: 암호학적 무결성 검증

```typescript
// 기본 기능
buildTree(leaves: SHA3Hash[]): MerkleTree
generateProof(tree: MerkleTree, leafIndex: number): MerkleProof
verifyProof(proof: MerkleProof): boolean

// 고급 기능
computeDiff(oldTree: MerkleTree, newTree: MerkleTree): TreeDiff
generateBatchProof(tree: MerkleTree, indices: number[]): BatchMerkleProof
generateRangeProof(tree: MerkleTree, start: number, end: number): RangeProof
createVersion(tree: MerkleTree): VersionedMerkleTree
```

### 8. HNSWIndex

**역할**: 고성능 근사 최근접 이웃 검색

```typescript
interface HNSWParams {
  M: number;              // 연결 수 (기본: 16)
  efConstruction: number; // 구축 시 탐색 너비 (기본: 200)
  efSearch: number;       // 검색 시 탐색 너비 (기본: 50)
  mL: number;             // 레벨 배수
}
```

**복잡도**:
- 삽입: O(log n)
- 검색: O(log n)
- 삭제 (soft): O(1) — tombstone Set에 추가, 구조 변경 없음
- 삭제 (compact): O(k) — k개 tombstone 노드 일괄 물리 제거
- 메모리: O(n * M)

**Soft-Delete 전략**:
- `delete(id)`: O(1) tombstone 마킹. 그래프 구조 유지, 검색/열거 시 필터링
- `forceDelete(id)`: 즉시 구조 제거. `updateNeuronEmbedding` 내부 전용
- `compact()`: 누적된 tombstone을 일괄 물리 제거. `CompactionScheduler`가 호출
- `tombstoneCount`: 현재 대기 중인 tombstone 수 (compact 트리거 기준)
- tombstone 50개 초과 시 또는 5분 경과 시 자동 compact 실행

---

## Data Flow

### Ingestion Flow

```
Input Text
    │
    ▼
┌─────────────────┐
│  ChunkEngine    │  CDC (Content-Defined Chunking)
│  - Split text   │  또는 Fixed-size chunking
│  - Hash chunks  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  EmbeddingProvider │  OpenAI / HuggingFace / Local
│  - Generate 384d │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MerkleEngine   │  SHA3-256 기반 트리 구축
│  - Build tree   │
│  - Get root     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  NeuronStore    │  LevelDB 영속화
│  - Create neuron│
│  - Index HNSW   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SynapseBuilder │  의미적 유사도 기반
│  - Find similar │  자동 시냅스 생성
│  - Create links │
└─────────────────┘
```

### Query Flow

```
Query Text
    │
    ▼
┌─────────────────┐
│  EmbeddingProvider │
│  - Embed query  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  HNSWIndex      │
│  - KNN search   │  Top-K 후보 검색
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Re-ranker      │
│  - Exact cosine │  정밀 재순위화
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  RAG (optional) │
│  - LLM context  │  검색 결과 + LLM 생성
└─────────────────┘
```

### DB Bridge Flow (SQL ↔ NMT Round-Trip)

```
                          ┌──────────────────────────┐
                          │    External Database      │
                          │  (MySQL / MariaDB / Mongo) │
                          └────────────┬─────────────┘
                                       │
                          ┌────────────┴─────────────┐
                          │   DB Connector (IDBConnector)  │
                          │  - connect / disconnect   │
                          │  - getSchema / readRows   │
                          │  - writeRows / createTable │
                          └────────────┬─────────────┘
                                       │
          ┌────────────────────────────┴────────────────────────────┐
          │                                                         │
          ▼ IMPORT                                         EXPORT ▼
┌───────────────────────┐                         ┌───────────────────────┐
│  DBBridgeService      │                         │  DBBridgeService      │
│  .importToNMT()       │                         │  .exportFromNMT()     │
│                       │                         │                       │
│  For each row:        │                         │  restoreSourceData?   │
│  ┌─────────────────┐  │                         │  ┌─────────────────┐  │
│  │ rowToText()     │  │                         │  │ YES: sourceRow  │  │
│  │ → "col:val ..."│  │                         │  │ from metadata   │  │
│  └────────┬────────┘  │                         │  │ (100% fidelity) │  │
│           │           │                         │  ├─────────────────┤  │
│  ┌────────▼────────┐  │                         │  │ NO: neuronToRow │  │
│  │ sanitizeRow()   │  │                         │  │ (NMT meta cols) │  │
│  │ Binary→base64   │  │                         │  └────────┬────────┘  │
│  │ Date→ISO string │  │                         │           │           │
│  └────────┬────────┘  │                         │  ┌────────▼────────┐  │
│           │           │                         │  │ desanitizeRow() │  │
│  ┌────────▼────────┐  │                         │  │ base64→Binary   │  │
│  │ ingestText()    │  │                         │  │ ISO→Date        │  │
│  │ + sourceRow     │  │                         │  └────────┬────────┘  │
│  │ + sourceColumns │  │                         │           │           │
│  │ + sourceFKs     │  │                         │  ┌────────▼────────┐  │
│  │ + sourceIndexes │  │                         │  │ createTable()   │  │
│  │ + sourceChecks  │  │                         │  │ from sourceColumns │
│  │ + sourceTriggers│  │                         │  │ + FKs, indexes  │  │
│  │ + sourceEngine  │  │                         │  │ + checks, trigs │  │
│  │ + sourceCharset │  │                         │  └────────┬────────┘  │
│  └────────┬────────┘  │                         │           │           │
│           │           │                         │  ┌────────▼────────┐  │
│           ▼           │                         │  │ writeRows()     │  │
│  NeuronNode with full │                         │  └─────────────────┘  │
│  DDL metadata stored  │                         │                       │
└───────────────────────┘                         └───────────────────────┘
          │                                                 ▲
          │              NMT Knowledge Graph                 │
          │  ┌────────────────────────────────────────┐     │
          └─▶│  NeuronNode.metadata = {               │─────┘
             │    sourceRow: {id:1, name:"홍길동"},    │
             │    sourceColumns: [{name,type,...}],    │
             │    sourceForeignKeys: [...],            │
             │    sourceIndexes: [...],                │
             │    sourceChecks: [...],                 │
             │    sourceTriggers: [...],               │
             │    sourceTable: "users",                │
             │    sourceEngine: "InnoDB",              │
             │    sourceCharset: "utf8mb4"             │
             │  }                                      │
             └────────────────────────────────────────┘
```

**Round-Trip Fidelity**: Import 시 모든 DDL 메타데이터(컬럼 타입, FK, 인덱스, CHECK, 트리거, 엔진, 캐릭터셋)와 원본 행 데이터를 뉴런 메타데이터에 보존. Export 시 `restoreSourceData: true`로 원본 DDL 구조와 데이터를 100% 복원.

### Inference Flow

```
Start Neuron
    │
    ├─────────────────────────────────┐
    │                                 │
    ▼                                 ▼
┌─────────────┐               ┌─────────────┐
│  Forward    │               │  Backward   │
│  Inference  │               │  Inference  │
│  (연역)     │               │  (귀납)     │
└──────┬──────┘               └──────┬──────┘
       │                             │
       ▼                             ▼
┌─────────────┐               ┌─────────────┐
│  Attractor  │               │  Attractor  │
│  Influence  │               │  Influence  │
└──────┬──────┘               └──────┬──────┘
       │                             │
       └─────────────┬───────────────┘
                     │
                     ▼
            ┌─────────────┐
            │  State      │
            │Distribution │
            │  (Optional) │
            └──────┬──────┘
                   │
                   ▼
            ┌─────────────┐
            │  Unified    │
            │  Result     │
            └─────────────┘
```

---

## Storage Architecture

### LevelDB Key Prefixes

| Prefix | Content | Example Key |
|--------|---------|-------------|
| `chunk:` | Raw data chunks | `chunk:abc123...` |
| `neuron:` | Neuron nodes | `neuron:uuid` |
| `synapse:` | Synaptic connections | `synapse:uuid` |
| `index:` | HNSW index data | `index:main` |
| `attractor:` | Attractor definitions | `attractor:uuid` |
| `pattern:` | Learned patterns | `pattern:uuid` |
| `process:` | Learned processes | `process:uuid` |
| `extract:` | Meaningful extracts | `extract:uuid` |
| `outcome:` | Outcome records | `outcome:uuid` |
| `dimension:` | Dynamic dimensions | `dimension:uuid` |
| `journal:` | Change journal entries | `journal:seq:00000001` |
| `state:` | Sync state metadata | `state:vectorclock` |

### Data Serialization

```typescript
// Neuron 직렬화
{
  id: string,
  embedding: number[],           // Float32Array → number[]
  chunkHashes: string[],
  merkleRoot: string,
  metadata: {
    createdAt: string,           // ISO 8601
    updatedAt: string,
    accessCount: number,
    neuronType: 'fact' | 'transient',
    importance: number,
    // DB Bridge round-trip fields (optional)
    sourceRow?: Record<string, unknown>,
    sourceColumns?: SourceColumnSchema[],
    sourceForeignKeys?: SourceForeignKey[],
    sourceIndexes?: SourceIndex[],
    sourceChecks?: SourceCheckConstraint[],
    sourceTriggers?: SourceTrigger[],
    sourceTable?: string,
    sourceEngine?: string,
    sourceCharset?: string
  },
  outgoingSynapses: string[],
  incomingSynapses: string[]
}
```

---

## Event System

### EventBus Architecture

```typescript
type SystemEventType =
  // Neuron events
  | 'neuron:created' | 'neuron:updated' | 'neuron:deleted'
  // Synapse events
  | 'synapse:formed' | 'synapse:updated' | 'synapse:removed'
  // Merkle events
  | 'merkle:root_changed' | 'merkle:proof_generated' | 'merkle:verified'
  // Learning events
  | 'learning:session_started' | 'learning:session_ended'
  | 'learning:extract' | 'learning:pattern' | 'learning:process' | 'learning:outcome'
  | 'learning:progress' | 'learning:complete' | 'learning:error'
  // Sync events
  | 'sync:state_changed' | 'sync:conflict' | 'sync:resolved'
  | 'sync:peer_connected' | 'sync:peer_disconnected'
  // Attractor events
  | 'attractor:created' | 'attractor:decayed' | 'attractor:activated'
  // Evolution events
  | 'evolution:started' | 'evolution:completed' | 'evolution:neuron_evolved'
```

### Event Flow

```
Producer                    EventBus                    Consumers
   │                           │                            │
   │   publish(event)          │                            │
   ├──────────────────────────▶│                            │
   │                           │   emit(type, event)        │
   │                           ├───────────────────────────▶│
   │                           │                            │
   │                           │   emit('*', event)         │
   │                           ├───────────────────────────▶│
   │                           │                            │
   │                           │   addToHistory(event)      │
   │                           │◀──────────────────────────┤│
```

### Event History

- 최대 1000개 이벤트 보관 (설정 가능)
- 타임스탬프 기반 필터링
- 상관 ID로 관련 이벤트 추적
- Prometheus 형식 메트릭 내보내기

---

## Synchronization Layer

### Vector Clock

```typescript
class VectorClock {
  private clock: Map<string, number>;

  tick(nodeId: string): void;           // 로컬 카운터 증가
  update(other: VectorClock): void;     // 다른 클럭과 병합
  compare(other: VectorClock):          // 인과 관계 비교
    'before' | 'after' | 'concurrent' | 'equal';
}
```

### Change Journal

```typescript
interface ChangeEntry {
  sequence: number;          // 순차 증가 시퀀스
  type: 'neuron' | 'synapse' | 'attractor' | 'pattern';
  operation: 'create' | 'update' | 'delete';
  entityId: string;
  data: unknown;
  vectorClock: Record<string, number>;
  timestamp: string;
  nodeId: string;
}
```

### Conflict Resolution

```
┌────────────────────────────────────────────────────────────┐
│                  Conflict Resolution                        │
│                                                             │
│  Strategy 1: Last-Write-Wins (LWW)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Compare timestamps → newer entry wins                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Strategy 2: Vector Clock Dominance                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ If A dominates B → A wins                           │   │
│  │ If concurrent → fallback to LWW                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Strategy 3: Custom Merge                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ User-defined resolver function                       │   │
│  │ (local, remote) => mergedEntry                       │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

### Data Integrity

1. **Merkle Root Verification**: 모든 뉴런 데이터는 Merkle root로 검증
2. **SHA3-256 Hashing**: 충돌 저항성 있는 해시 함수 사용
3. **Proof Generation**: 개별 청크의 포함 증명 생성 가능

### Input Validation

1. **Path Sanitization**: 디렉토리 순회 공격 방지
2. **Payload Size Limits**: DoS 방지를 위한 페이로드 크기 제한
3. **Schema Validation**: CLI 입력값 타입/범위 검증

### DB Connector Security

1. **Identifier Validation**: 테이블/컬럼명에 alphanumeric, underscore, hyphen, dot만 허용 (SQL injection 방지)
2. **Parameterized Queries**: 모든 WHERE/값 전달에 prepared statement 사용
3. **NoSQL Injection Prevention**: MongoDB 쿼리에서 `$` 연산자 거부
4. **Raw WHERE 차단**: MySQL readRows에서 raw WHERE 절 지원하지 않음

### Resource Protection

1. **Timeout Protection**: waitFor()에 기본 타임아웃 설정
2. **Mutex Locks**: 동시 쓰기 방지
3. **Connection Cleanup**: 리소스 누수 방지

---

## Performance Optimization

### HNSW Index

- **M=16**: 연결 수 (정확도 vs 메모리 트레이드오프)
- **efConstruction=200**: 구축 품질
- **efSearch=50**: 검색 속도 vs 정확도
- **Soft-delete**: O(1) tombstone으로 즉각 삭제 응답, 구조 재계산 없음
- **CompactionScheduler**: tombstone 50개 초과 또는 5분 경과 시 백그라운드 compact

### Concurrency — SerialTaskQueue

LevelDB synapse 레코드는 read-modify-write 패턴이므로 동시 실행 시 lost update 발생.
`SerialTaskQueue`가 Hebbian learning 3개 작업(reinforceCoActivation, inhibitCoActivation, encodeEpisode)을 직렬화.
- fire-and-forget: 에러 시 `servicesLogger.warn`, 큐 풀(>100) 시 드롭 + 로깅
- pending/dropped 카운터로 모니터링 가능

### Batch Parallelization — parallelChunk

순차 for-loop 대신 청크 단위 병렬 실행으로 처리량 향상:
- `embedBatch`: concurrency=3 (Xenova CPU-bound 단일 파이프라인)
- `ingestBatch`: concurrency=5 (독립 key → LevelDB 충돌 없음)
- 결과 순서 보장 (Promise.all per chunk)

### LevelDB Tuning

- Iterator 기반 범위 조회
- 배치 쓰기로 트랜잭션 처리
- `compactRange('\x00', '\xff')`: 삭제 후 SST 파일 재병합, 디스크 공간 회수
- `CompactionScheduler`가 HNSW compact + LevelDB compactRange를 함께 실행

### Event System

- 히스토리 상한선으로 메모리 제어
- 비동기 핸들러 지원
- 타입별 구독으로 불필요한 이벤트 필터링

### Memory Management

- Float32Array로 임베딩 저장 (Float64 대비 50% 절감)
- Map 대신 Object 사용 (직렬화 용이)
- dispose() 패턴으로 명시적 정리

### Crash Recovery

3개 진입점(bin/nmt.ts, cli-server.ts, mcp/server.ts) 모두 `uncaughtException` + `unhandledRejection` 핸들러 등록.
프로세스 비정상 종료 시 DB close → HNSW index 저장 시도 후 종료.

---

## Appendix: Type Definitions

### Core Types

```typescript
type UUID = string;                    // UUID v4
type SHA3Hash = string;                // 64 hex characters
type ISO8601 = string;                 // Timestamp
type Embedding384 = Float32Array;      // 384-dimensional vector
type MerkleRoot = SHA3Hash;            // Root hash
```

### Enum Types

```typescript
type SynapseType =
  | 'SEMANTIC' | 'TEMPORAL' | 'CAUSAL'
  | 'ASSOCIATIVE' | 'HIERARCHICAL' | 'DUPLICATE';

type NeuronType = 'fact' | 'transient';

type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

type ComponentStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
```

---

*Last Updated: February 2026 (v1.1.0 — DB Bridge & Round-Trip Fidelity)*
