# NMT 시스템 완전 사용 가이드

> **NMT (Neuron Merkle Tree)** - 확률적 존재론 기반의 검증 가능한 의미적 지식 그래프

---

## 목차

1. [NMT가 뭐야?](#1-nmt가-뭐야)
2. [설치하기](#2-설치하기)
3. [기본 사용법](#3-기본-사용법)
4. [고급 기능 - 확률적 시스템](#4-고급-기능---확률적-시스템)
5. [상태 동기화](#5-상태-동기화)
6. [검증 및 증명](#6-검증-및-증명)
7. [대시보드 사용하기](#7-대시보드-사용하기)
8. [실전 시나리오](#8-실전-시나리오)
9. [문제 해결](#9-문제-해결)
10. [용어 정리](#10-용어-정리)

---

## 1. NMT가 뭐야?

### 한 줄 설명

**NMT**는 "지식을 확률로 표현하고, 암호학적으로 검증할 수 있는 똑똑한 데이터베이스"입니다.

### 기존 방식 vs NMT 방식

| 기존 데이터베이스 | NMT |
|-----------------|-----|
| 데이터는 하나의 값 | 데이터는 **여러 가능성의 확률 분포** |
| "사과 = 빨간 과일" | "사과 = 빨간 과일(60%) / 회사(30%) / 녹색(10%)" |
| 검색하면 정확히 일치하는 것만 | **의미적으로 비슷한 것**도 찾음 |
| 데이터 변조 여부 모름 | **Merkle Tree로 변조 즉시 감지** |
| 원인→결과만 | **결과→원인도 추론 가능** |

### 핵심 개념 5가지

#### 1) 뉴런 (Neuron) = 지식 단위
```
텍스트를 저장하면 → "뉴런" 생성
"React는 UI 라이브러리입니다" → 뉴런 1개
```

#### 2) 시냅스 (Synapse) = 지식 간 연결
```
의미적으로 비슷한 뉴런은 자동 연결
"React" ←---연결---→ "Vue" ←---연결---→ "Angular"
```

#### 3) 확률 분포 (Probability Distribution) = 여러 가능성의 중첩
```
"배" 뉴런 = [ "과일"(40%) + "선박"(35%) + "신체"(25%) ]
맥락에 따라 관측하면 하나로 확정
```

#### 4) 끌개 (Attractor) = 목표가 현재에 영향
```
목표: "TypeScript 마스터"
→ 관련 학습 자료가 더 높은 우선순위로 추천됨
→ 미래 목표가 현재 결정을 "끌어당김"
```

#### 5) Merkle Tree = 변조 방지 장치
```
모든 데이터에 암호학적 "지문"(해시) 생성
누가 데이터를 바꾸면 지문이 달라져서 바로 감지
```

### 어디에 쓸 수 있어?

| 대상 | 활용 방식 |
|------|----------|
| **개인** | 지식 관리, 학습 기록, 아이디어 연결 |
| **개발팀** | 기술 문서 검색, 코드 지식 베이스 |
| **연구자** | 논문/자료 관리, 인과 관계 분석 |
| **기업** | 사내 위키, AI 학습 데이터 관리 |
| **블록체인** | 검증 가능한 데이터 저장, 증명 생성 |

---

## 2. 설치하기

### 필요한 것들

- **Node.js 18+**: https://nodejs.org
- **Git** (선택): https://git-scm.com

### 설치 과정

```bash
# 1. 저장소 클론
git clone https://github.com/ninebix/nmt-system.git
cd nmt-system

# 2. 의존성 설치
npm install

# 3. 빌드
npm run build

# 4. CLI 전역 등록 (선택)
npm link

# 5. 환경 설정 (선택)
cp .env.example .env
# .env 파일 편집하여 API 키 설정
```

### 첫 실행

```bash
# 시스템 상태 확인
nmt prob health

# 도움말
nmt --help
```

---

## 3. 기본 사용법

### 3.1 데이터 학습 (Ingestion)

#### CLI로 학습

```bash
# 텍스트 직접 학습
nmt ingest --text "React는 Facebook이 만든 UI 라이브러리입니다."

# 태그와 함께 학습
nmt ingest --text "TypeScript는 타입이 있는 JavaScript입니다." --tags "typescript,frontend"

# 파일에서 학습
nmt ingest --file ./documents/guide.txt
```

#### API로 학습

```bash
# 텍스트 학습
curl -X POST http://localhost:3000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "학습할 내용", "tags": ["태그1", "태그2"]}'

# URL 학습
curl -X POST http://localhost:3000/api/v1/ingest/url \
  -d '{"url": "https://example.com/article"}'

# 파일 업로드
curl -X POST http://localhost:3000/api/v1/files/ingest \
  -F "file=@./data.xlsx"
```

### 3.2 검색 (Query)

#### CLI 검색

```bash
# 기본 검색
nmt query "React 상태 관리" --k 5

# 상세 결과
nmt query "TypeScript 타입" --k 10 --verbose
```

#### API 검색

```bash
# 의미적 검색
curl -X POST http://localhost:3000/api/v1/query/search \
  -d '{"query": "검색어", "k": 10}'

# RAG 검색 (LLM 연동)
curl -X POST http://localhost:3000/api/v1/rag/query \
  -d '{"query": "질문 내용", "topK": 5}'
```

### 3.3 그래프 탐색

```bash
# 뉴런 상세 정보
nmt graph neuron <neuron-id>

# 연결된 뉴런들
nmt graph connected <neuron-id> --depth 2

# 전체 통계
nmt graph stats
```

---

## 4. 고급 기능 - 확률적 시스템

### 4.1 양방향 추론 (Bidirectional Inference)

#### 순방향 추론 (원인 → 결과)

```bash
nmt infer forward <neuron-id> --depth 5

# 예: "프로그래밍"에서 시작
# 결과: 프로그래밍 → Python → 머신러닝 → 딥러닝 → AI
```

**활용**: "이 기술을 배우면 무엇을 할 수 있나?"

#### 역방향 추론 (결과 → 원인)

```bash
nmt infer backward <neuron-id> --depth 5

# 예: "성공적인 프로젝트"에서 역추론
# 결과: 성공 ← 좋은 설계 ← 요구사항 분석 ← 고객 이해
```

**활용**: "이 결과를 얻으려면 무엇이 필요한가?"

#### 인과 관계 탐색

```bash
nmt infer causal <from-id> <to-id>

# 두 개념 사이의 인과 경로 찾기
```

### 4.2 목표 끌개 (Attractor Model)

#### 끌개 생성

```bash
# 목표 설정
nmt attractor create "프로젝트 완료" \
  --description "MVP 개발 및 배포" \
  --priority 9 \
  --deadline 2025-03-31
```

#### 경로 계산

```bash
# 현재 → 목표 경로
nmt attractor path <current-neuron> <attractor-id>

# 결과:
# Path probability: 0.73
# Steps: 현재 → 설계 → 개발 → 테스트 → 배포
# Bottlenecks: [테스트 자동화 부족]
```

#### 영향력 조회

```bash
nmt attractor influence <neuron-id>

# 어떤 목표가 현재 결정에 가장 큰 영향을 미치는지
```

### 4.4 4단계 학습 (Four-Stage Learning)

```
Stage 1: Extract (추출) - 핵심 내용 식별
Stage 2: Pattern (패턴) - 반복 패턴 인식
Stage 3: Process (과정) - AI 추론 과정 학습
Stage 4: Outcome (결과) - 피드백으로 개선
```

#### 학습 실행

```bash
# 세션 시작
nmt learn session start

# 추출
nmt learn extract <neuron-id> --limit 10

# 통합 학습
nmt orchestrate learn \
  --input "React에서 상태 관리는?" \
  --output "useState, Context API 사용" \
  --success \
  --feedback 0.9

# 세션 종료
nmt learn session end
```

### 4.5 통합 오케스트레이션

```bash
# 모든 모듈 결합 추론
nmt orchestrate infer <neuron-id> --depth 3

# 피드백 제공
nmt orchestrate feedback \
  --input-neuron <id> \
  --output-neuron <id> \
  --quality 0.85

# 성공 경로 강화
nmt orchestrate reinforce \
  --from <neuron-a> \
  --to <neuron-b> \
  --strength 0.2
```

---

## 5. 상태 동기화

### 5.1 동기화 상태 확인

```bash
nmt sync status

# 출력:
# Node ID:      node-abc123
# Sequence:     42
# Merkle Root:  def456...
# Last Sync:    2025-02-27T10:30:00Z
# Vector Clock:
#   node-abc123: 42
# Connected Peers: 1
```

### 5.2 변경 로그 조회

```bash
# 전체 변경 이력
nmt sync changes --from 0 --limit 50

# 특정 시퀀스 이후
nmt sync changes --from 35
```

### 5.3 상태 내보내기/가져오기

```bash
# 백업
nmt sync export --output ./backup/state-2025-02-27.json

# 복원
nmt sync import ./backup/state-2025-02-27.json
```

### 5.4 피어 관리

```bash
# 연결된 피어 목록
nmt sync peers

# 저널 통계
nmt sync journal
```

---

## 6. 검증 및 증명

### 6.1 무결성 검증

```bash
# 특정 뉴런 검증
nmt verify neuron <neuron-id>

# 전체 시스템 검증
nmt verify all
```

### 6.2 Merkle 증명 생성

```bash
# 단일 증명
nmt verify proof <neuron-id> --index 2

# 배치 증명 (여러 개 동시)
nmt verify batch <neuron-id> --indices 0,2,5

# 범위 증명
nmt verify range <neuron-id> --start 0 --end 10
```

### 6.3 두 뉴런 비교

```bash
nmt verify diff <neuron-a> <neuron-b>
```

---

## 7. 대시보드 사용하기

### 실행

```bash
cd dashboard
npm install
npm run dev
```

브라우저에서 http://localhost:5173 접속

### 화면 구성

| 메뉴 | 기능 |
|------|------|
| Dashboard | 전체 통계, 최근 활동 |
| Search | 의미적 검색, RAG 질의 |
| Learning | 텍스트/URL 학습 |
| Neurons | 뉴런 목록, 상세 정보 |
| Graph | 지식 그래프 시각화 |
| Settings | LLM 설정, 시스템 구성 |

---

## 8. 실전 시나리오

### 시나리오 1: 기술 문서 지식 베이스

```bash
# 1. 문서 학습
nmt ingest --file ./docs/api-guide.md --tags "api"
nmt ingest --url "https://wiki.company.com/arch"

# 2. 검색 테스트
nmt query "배포 프로세스" --k 5

# 3. RAG 질의
nmt rag "새 서비스를 어떻게 배포하나요?"
```

### 시나리오 2: AI 학습 기록

```bash
# 1. 학습 세션 시작
nmt learn session start

# 2. 추론 과정 기록
nmt orchestrate learn \
  --input "코드 최적화 요청" \
  --output "캐싱 적용, 알고리즘 개선" \
  --success \
  --feedback 0.85

# 3. 세션 종료
nmt learn session end
```

### 시나리오 3: 의사결정 지원

```bash
# 1. 목표 설정
nmt attractor create "매출 증가" --priority 10

# 2. 현재 상황 분석
nmt infer forward <current-situation-neuron>

# 3. 목표까지 경로
nmt attractor path <current> <goal>
```

---

## 9. 문제 해결

### "Neuron not found"

```bash
# 뉴런 목록 확인
nmt graph list --limit 10
```

### "EBUSY: resource busy or locked"

Windows에서 DB 파일 잠금 문제. 잠시 대기 후 자동 재시도됨.

### "Validation Error"

```bash
# 파라미터 범위 확인
nmt <command> --help
```

### 서버가 안 켜짐

```bash
# 기존 프로세스 종료
taskkill /F /IM node.exe  # Windows
pkill node                 # Mac/Linux

# data 폴더 삭제 (데이터 초기화)
rm -rf data

# 다시 실행
npm run dev
```

---

## 10. 용어 정리

| 용어 | 영어 | 설명 |
|------|------|------|
| 뉴런 | Neuron | 저장된 하나의 지식 단위 |
| 시냅스 | Synapse | 뉴런 간 연결 |
| 임베딩 | Embedding | 텍스트를 숫자 벡터로 변환 |
| 머클 트리 | Merkle Tree | 무결성 검증용 해시 트리 |
| 끌개 | Attractor | 미래 목표 상태 |
| 중첩 | Superposition | 여러 상태의 동시 존재 |
| 관측 | Observation | 상태를 하나로 확정 |
| 얽힘 | Entanglement | 두 뉴런의 상관관계 |
| 벡터 클럭 | Vector Clock | 분산 환경 인과 관계 추적 |
| HNSW | - | 고속 벡터 검색 알고리즘 |

---

## 부록: 명령어 빠른 참조

### 필수

```bash
nmt prob health              # 시스템 상태
nmt ingest --text "..."      # 텍스트 학습
nmt query "..."              # 검색
nmt sync status              # 동기화 상태
```

### 추론

```bash
nmt infer forward <id>       # 순방향 추론
nmt infer backward <id>      # 역방향 추론
nmt infer causal <a> <b>     # 인과 관계
```

### 끌개

```bash
nmt attractor create "..."   # 목표 생성
nmt attractor path <a> <b>   # 경로 계산
nmt attractor influence <id> # 영향력 조회
```

### 관리

```bash
nmt sync export              # 상태 내보내기
nmt sync import <file>       # 상태 가져오기
nmt verify neuron <id>       # 무결성 검증
nmt prob metrics             # 메트릭 조회
```

---

*Last Updated: February 2026*

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
