<!--
================================================================================
NINEBIX inc. (주식회사 나인빅스)
Email   : sobdi90@9bix.com
Website : https://9bix.com
Corp ID : 476-86-03488
================================================================================
-->

# NMT System (Neuron Merkle Tree)

**확률적 존재론 기반 검증 가능한 의미적 지식 그래프 시스템**

A Probabilistic Ontology-based Verifiable Semantic Knowledge Graph System

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-NSAL%20v1.0-orange)](LICENSE)

---

## Target Audience

| 대상 | 활용 방식 |
|------|----------|
| **AI/ML 연구자** | 확률적 추론, 확률 분포 기반 지식 표현 연구 |
| **지식 그래프 개발자** | 검증 가능한 분산 지식 베이스 구축 |
| **LLM 애플리케이션 개발자** | RAG 시스템 백엔드, 맥락 기반 검색 |
| **블록체인/DeFi 개발자** | Merkle 증명 기반 데이터 무결성 검증 |
| **기업 R&D 팀** | 사내 지식 관리, AI 학습 데이터 파이프라인 |

---

## Core Features

### 1. Probabilistic Ontology (확률적 존재론)

기존 결정론적 지식 그래프와 달리, **모든 지식이 확률 분포로 존재**합니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│              Probabilistic Ontology Framework                        │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  Probabilistic│    │   Attractor  │    │ Bidirectional│          │
│  │    States     │───▶│    Model     │───▶│  Inference   │          │
│  │  (확률분포)   │    │  (목표 끌개) │    │ (양방향추론) │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                   │                   │
│         └───────────────────┴───────────────────┘                   │
│                             │                                       │
│                    ┌────────┴────────┐                             │
│                    │  Four-Stage     │                             │
│                    │  Learning       │                             │
│                    │ (4단계 학습)    │                             │
│                    └─────────────────┘                             │
└─────────────────────────────────────────────────────────────────────┘
```

#### 왜 확률적 존재론인가?

| 기존 방식 | NMT 확률적 방식 | 이점 |
|----------|----------------|------|
| "A는 B이다" (결정론) | "A가 B일 확률 0.85" | 불확실성 표현 가능 |
| 단일 정답 | 다중 가능성 분포 | 복잡한 현실 반영 |
| 정적 지식 | 관측/맥락에 따른 변화 | 동적 추론 가능 |
| 원인→결과 단방향 | 원인↔결과 양방향 | 역추론/귀납 가능 |

---

### 2. Attractor Model (목표 끌개 모델)

**미래 목표가 현재 결정에 영향**을 미치는 목적론적 추론 시스템.

```typescript
// 목표 끌개 생성
nmt attractor create "프로젝트 완료" --priority 9 --deadline 2025-03-31

// 현재 상태에서 목표까지의 경로 계산
nmt attractor path neuron-current attractor-goal

// 목표 확률장의 영향력 계산
nmt attractor influence neuron-xyz
```

**활용 사례:**
- 목표 기반 의사결정 지원
- 프로젝트 계획 최적화
- 학습 경로 추천

---

### 3. Four-Stage Learning (4단계 학습 시스템)

AI 학습을 **인간의 학습 과정과 유사하게** 구조화:

```
Stage 1: Extract (추출)
   ↓
   유의미한 정보 추출 및 키워드 식별
   ↓
Stage 2: Pattern (패턴)
   ↓
   반복 패턴 인식 및 분류
   ↓
Stage 3: Process (과정)
   ↓
   AI 추론 과정 자체를 학습
   ↓
Stage 4: Outcome (결과)
   ↓
   결과 피드백으로 전체 시스템 개선
```

```bash
# 학습 세션 시작
nmt learn session start

# 내용 추출
nmt learn extract neuron-abc --limit 20

# 4단계 전체 실행
nmt orchestrate learn --input "질문" --output "답변" --success --feedback 0.9
```

---

### 4. Bidirectional Inference (양방향 추론)

원인→결과 (연역)와 결과→원인 (귀납)을 **동시에 수행**:

```bash
# 순방향 추론 (원인 → 결과)
nmt infer forward neuron-cause --depth 5

# 역방향 추론 (결과 → 원인)
nmt infer backward neuron-effect --depth 5

# 인과 관계 탐색
nmt infer causal neuron-a neuron-b

# 양방향 통합 추론
nmt infer bidirectional neuron-xyz --depth 3
```

---

### 5. Merkle Tree Verification (머클 트리 검증)

모든 데이터의 **암호학적 무결성 검증** 지원:

```bash
# 뉴런 무결성 검증
nmt verify neuron neuron-abc

# 증명 생성
nmt verify proof neuron-abc --index 2

# 두 뉴런 간 차이 비교
nmt verify diff neuron-abc neuron-xyz

# 배치 증명
nmt verify batch neuron-abc --indices 0,2,5
```

**Merkle 기능:**
- Tree Diff: 두 트리 간 변경 사항 추적
- Batch Proof: 다중 리프 동시 증명
- Range Proof: 범위 기반 부분 검증
- Versioned Tree: 버전 관리 및 롤백

---

### 6. State Synchronization (상태 동기화)

**분산 환경**을 위한 동기화 인프라:

```bash
# 동기화 상태 확인
nmt sync status

# 변경 로그 조회
nmt sync changes --from 0

# 상태 내보내기
nmt sync export --output backup.json

# 상태 가져오기
nmt sync import backup.json

# 연결된 피어 목록
nmt sync peers

# 저널 통계
nmt sync journal
```

**동기화 기능:**
- Vector Clock: 분산 환경 인과 관계 추적
- Change Journal: 변경 이력 저널링
- Conflict Resolution: Last-Write-Wins, Vector Clock, Custom Merge 전략
- Merkle-based Diff: 효율적인 상태 비교

---

### 7. Dynamic Embedding (동적 임베딩)

**차원을 동적으로 추가/수정** 가능한 유연한 임베딩:

```bash
# 새 차원 등록
nmt dimension register "감정" --category "sentiment"

# 카테고리별 차원 조회
nmt dimension category "sentiment"

# 뉴런에 차원 값 설정
nmt dimension set neuron-abc "감정" 0.8
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone
git clone https://github.com/ninebix/nmt-system.git
cd nmt-system

# Install
npm install

# Build
npm run build
```

### CLI Usage

```bash
# 전역 설치 (선택)
npm link

# 도움말
nmt --help

# 시스템 상태 확인
nmt prob health

# 텍스트 학습
nmt ingest --text "학습할 내용" --tags "태그1,태그2"

# 검색
nmt query "검색어" --k 10

# 통합 추론
nmt orchestrate infer neuron-abc --depth 3
```

### API Server

```bash
# 개발 서버 시작
npm run dev

# 프로덕션 빌드 후 실행
npm run build
npm start
```

- Backend API: http://localhost:3000
- Dashboard: http://localhost:5173

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
│  │  │(검증/증명) │  │(벡터검색)  │  │(그래프탐색)│              │  │
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

## Project Structure

```
nmt-system/
├── bin/
│   └── nmt.ts              # CLI entry point
├── src/
│   ├── api/                # REST API (Express)
│   ├── cli/                # CLI commands
│   │   ├── commands/       # Command implementations
│   │   └── utils/          # Validators, formatters
│   ├── core/               # Core engines
│   │   ├── merkle-engine.ts
│   │   ├── hnsw-index.ts
│   │   ├── neuron-graph.ts
│   │   ├── probabilistic-orchestrator.ts
│   │   ├── probabilistic-neuron.ts
│   │   ├── bidirectional-inference.ts
│   │   ├── attractor-model.ts
│   │   ├── dynamic-embedding.ts
│   │   └── evolution-scheduler.ts
│   ├── events/             # Event system
│   │   ├── event-bus.ts
│   │   └── progress-tracker.ts
│   ├── services/           # Business logic
│   │   ├── four-stage-learning.ts
│   │   ├── ingestion.ts
│   │   ├── query.ts
│   │   └── embedding-provider.ts
│   ├── storage/            # Persistence (LevelDB)
│   │   ├── probabilistic-store.ts
│   │   ├── neuron-store.ts
│   │   └── chunk-store.ts
│   ├── sync/               # State synchronization
│   │   ├── state-sync.ts
│   │   ├── change-journal.ts
│   │   └── vector-clock.ts
│   ├── types/              # TypeScript definitions
│   └── utils/              # Utilities
├── tests/                  # Test suites
├── dashboard/              # React dashboard (optional)
├── docs/                   # Documentation
└── data/                   # Runtime data
```

---

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/ingest` | POST | 텍스트 학습 |
| `/api/v1/ingest/url` | POST | URL 학습 |
| `/api/v1/query/search` | POST | 의미적 검색 |
| `/api/v1/rag/query` | POST | RAG 질의 |
| `/api/v1/graph/neuron/:id` | GET | 뉴런 상세 |
| `/api/v1/graph/full` | GET | 전체 그래프 |
| `/api/v1/health` | GET | 헬스 체크 |
| `/api/v1/metrics` | GET | 시스템 메트릭 |

### CLI Commands

| Category | Commands |
|----------|----------|
| **Inference** | `infer forward`, `backward`, `causal`, `bidirectional` |
| **Learning** | `learn extract`, `session` |
| **Attractor** | `attractor create`, `path`, `influence` |
| **Dimension** | `dimension register`, `category`, `set` |
| **Orchestrate** | `orchestrate infer`, `learn`, `feedback`, `reinforce` |
| **Sync** | `sync status`, `changes`, `export`, `import`, `peers` |
| **System** | `prob metrics`, `health`, `prometheus` |

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

## Documentation

### English
- [User Guide](docs/USER_GUIDE_EN.md)
- [CLI API Reference](docs/CLI_API_EN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Quick Reference](docs/QUICK_REFERENCE.md)

### 한국어 (Korean)
- [한글 문서](docs/README_KO.md)
- [사용자 가이드](docs/USER_GUIDE.md)
- [CLI API 레퍼런스](docs/CLI_API.md)

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

- Built with TypeScript, React, Express, LevelDB
- Vector search powered by HNSW algorithm
- Cryptographic hashing via SHA3-256

---

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
