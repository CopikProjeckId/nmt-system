# NMT (Neuron Merkle Tree) 시스템

## 확률적 존재론 기반 검증 가능한 의미적 지식 그래프

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org)

---

## 개요

NMT는 **확률적 존재론(Probabilistic Ontology)** 기반의 지식 그래프 시스템입니다.

기존 결정론적 데이터베이스와 달리, **모든 지식이 확률 분포로 존재**하며,
**암호학적으로 검증 가능**합니다.

### 왜 확률적 존재론인가?

| 기존 방식 | NMT 확률적 방식 | 이점 |
|----------|----------------|------|
| "A는 B이다" | "A가 B일 확률 0.85" | 불확실성 표현 |
| 단일 정답 | 다중 가능성 분포 | 현실 복잡성 반영 |
| 원인→결과 단방향 | 원인↔결과 양방향 | 역추론/귀납 가능 |
| 데이터 변조 불확실 | Merkle 증명으로 검증 | 무결성 보장 |

---

## 핵심 기능

### 1. 양방향 추론 (Bidirectional Inference)

```bash
# 순방향 (원인 → 결과)
nmt infer forward <neuron-id> --depth 5

# 역방향 (결과 → 원인)
nmt infer backward <neuron-id> --depth 5

# 인과 관계 탐색
nmt infer causal <from-id> <to-id>
```

### 2. 목표 끌개 (Attractor Model)

**미래 목표가 현재 결정에 영향**을 미치는 목적론적 추론 시스템.

```bash
# 목표 끌개 생성
nmt attractor create "프로젝트 완료" --priority 9 --deadline 2025-03-31

# 현재 → 목표 경로 계산
nmt attractor path <current-neuron> <attractor-id>

# 영향력 조회
nmt attractor influence <neuron-id>
```

### 3. 4단계 학습 (Four-Stage Learning)

```
Stage 1: Extract (추출) - 핵심 내용 식별
Stage 2: Pattern (패턴) - 반복 패턴 인식
Stage 3: Process (과정) - AI 추론 과정 학습
Stage 4: Outcome (결과) - 피드백으로 개선
```

```bash
# 통합 학습
nmt orchestrate learn \
  --input "질문" \
  --output "답변" \
  --success \
  --feedback 0.9
```

### 4. Merkle 검증 (Cryptographic Verification)

```bash
# 무결성 검증
nmt verify neuron <neuron-id>

# 증명 생성
nmt verify proof <neuron-id> --index 2

# 배치 증명
nmt verify batch <neuron-id> --indices 0,2,5
```

### 5. 상태 동기화 (State Synchronization)

분산 환경을 위한 Vector Clock 기반 동기화.

```bash
# 상태 확인
nmt sync status

# 변경 로그
nmt sync changes --from 0

# 상태 백업/복원
nmt sync export --output backup.json
nmt sync import backup.json
```

---

## 대상 사용자

| 대상 | 활용 방식 |
|------|----------|
| **AI/ML 연구자** | 확률적 추론, 양자 상태 기반 지식 표현 |
| **지식 그래프 개발자** | 검증 가능한 분산 지식 베이스 |
| **LLM 개발자** | RAG 시스템 백엔드, 맥락 기반 검색 |
| **블록체인 개발자** | Merkle 증명 기반 데이터 무결성 |
| **기업 R&D** | 사내 지식 관리, AI 학습 파이프라인 |

---

## 빠른 시작

### 설치

```bash
# 저장소 클론
git clone https://github.com/ninebix/nmt-system.git
cd nmt-system

# 의존성 설치
npm install

# 빌드
npm run build

# CLI 전역 등록 (선택)
npm link
```

### 첫 실행

```bash
# 시스템 상태 확인
nmt prob health

# 도움말
nmt --help

# 텍스트 학습
nmt ingest --text "학습할 내용" --tags "태그1,태그2"

# 검색
nmt query "검색어" --k 10
```

### 서버 실행

```bash
# 개발 서버
npm run dev

# 프로덕션
npm run build && npm start
```

- Backend API: http://localhost:3000
- Dashboard: http://localhost:5173

---

## 아키텍처

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
│  │  │    (State Distribution + Observation + Correlation)  │    │   │
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

## CLI 명령어 요약

### 추론

```bash
nmt infer forward <id> --depth 3    # 순방향 추론
nmt infer backward <id> --depth 3   # 역방향 추론
nmt infer causal <from> <to>        # 인과 관계
nmt infer bidirectional <id>        # 양방향 통합
```

### 끌개

```bash
nmt attractor create "목표" --priority 9    # 끌개 생성
nmt attractor path <current> <goal>         # 경로 계산
nmt attractor influence <id>                # 영향력 조회
```

### 학습

```bash
nmt learn session start              # 세션 시작
nmt learn extract <id> --limit 10    # 추출
nmt orchestrate learn --input "..." --output "..." --success
nmt learn session end                # 세션 종료
```

### 동기화

```bash
nmt sync status                      # 상태 확인
nmt sync changes --from 0            # 변경 로그
nmt sync export --output backup.json # 내보내기
nmt sync import backup.json          # 가져오기
nmt sync peers                       # 피어 목록
```

### 검증

```bash
nmt verify neuron <id>                  # 무결성 검증
nmt verify proof <id> --index 2         # 증명 생성
nmt verify batch <id> --indices 0,2,5   # 배치 증명
nmt verify diff <id-a> <id-b>           # 차이 비교
```

### 시스템

```bash
nmt prob health        # 헬스 체크
nmt prob metrics       # 메트릭 조회
nmt prob prometheus    # Prometheus 형식
```

---

## 성능

| 항목 | 성능 |
|------|------|
| HNSW 검색 (100K 벡터) | < 10ms |
| Merkle 증명 생성 | < 1ms |
| 배치 증명 (100 리프) | < 5ms |
| 이벤트 발행 | < 100μs |
| 상태 동기화 diff | O(log n) |

---

## 문서

- [사용자 가이드](USER_GUIDE.md)
- [CLI API 레퍼런스](CLI_API.md)
- [아키텍처 문서](ARCHITECTURE.md)
- [빠른 참조](QUICK_REFERENCE.md)

---

## 라이선스

NINEBIX Source Available License (NSAL) v1.0

**허용:**
- 소스 코드 열람, 학습
- 개인/비상업적 사용
- 동일 라이선스로 포크

**상업적 사용**은 별도 라이선스 필요. 문의: sobdi90@9bix.com

---

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
