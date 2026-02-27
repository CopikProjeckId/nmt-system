# NMT 시스템 (Neuron Merkle Tree)

**확률적 존재론 기반 검증 가능한 의미적 지식 그래프 시스템**

[![npm version](https://img.shields.io/npm/v/@ninebix/nmt-system.svg)](https://www.npmjs.com/package/@ninebix/nmt-system)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org)

NMT는 **모든 지식이 확률 분포로 존재**하는 지식 그래프 시스템입니다.

---

## 대상 사용자

| 대상 | 활용 방식 |
|------|----------|
| **AI/ML 연구자** | 확률적 추론, 확률 분포 기반 지식 표현 연구 |
| **지식 그래프 개발자** | 검증 가능한 분산 지식 베이스 구축 |
| **LLM 애플리케이션 개발자** | RAG 시스템 백엔드, 맥락 기반 검색 |
| **블록체인/DeFi 개발자** | Merkle 증명 기반 데이터 무결성 검증 |
| **기업 R&D 팀** | 사내 지식 관리, AI 학습 데이터 파이프라인 |

---

## 주요 기능

### 1. 확률적 존재론

| 기존 방식 | NMT 방식 | 이점 |
|----------|---------|------|
| "A는 B이다" | "A가 B일 확률 0.85" | 불확실성 표현 |
| 단일 정답 | 다중 가능성 분포 | 복잡한 현실 반영 |
| 정적 지식 | 맥락에 따른 변화 | 동적 추론 |
| 원인→결과 | 원인↔결과 양방향 | 역추론 가능 |

### 2. 목표 끌개 모델

미래 목표가 현재 결정에 영향을 미치는 목적론적 추론.

### 3. 4단계 학습

Extract → Pattern → Process → Outcome

### 4. 양방향 추론

순방향(연역) + 역방향(귀납) 동시 수행.

### 5. Merkle 검증

암호학적 무결성 검증, 배치 증명, 버전 관리.

### 6. 상태 동기화

Vector Clock, Change Journal, 충돌 해결.

### 7. DB Bridge (SQL ↔ NMT)

외부 데이터베이스와 NMT 간 양방향 데이터 전송. MySQL/MariaDB, MongoDB 지원.
Import 시 DDL 메타데이터(컬럼 타입, FK, 인덱스, CHECK, 트리거) 100% 보존, Export 시 원본 구조 그대로 복원.

---

## 설치

```bash
npm install -g @ninebix/nmt-system
```

---

## 빠른 시작

```bash
nmt init
nmt ingest ./document.txt --tags "tag1,tag2"
nmt search "검색어" --k 10
nmt infer forward <neuron-id> --depth 3
```

---

## CLI 명령어

| 카테고리 | 명령어 |
|----------|--------|
| **기본** | init, ingest, search, get, list, stats |
| **추론** | infer forward, backward, causal, bidirectional |
| **학습** | learn extract, session |
| **끌개** | attractor create, path, influence |
| **검증** | verify neuron, proof, diff, batch |
| **동기화** | sync status, changes, export, import |
| **DB Bridge** | REST API: /db/connect, /db/schema, /db/import, /db/export |

---

## 라이선스

[NINEBIX Source Available License (NSAL) v1.0](../LICENSE)

상업적 사용은 별도 라이선스 필요. 문의: sobdi90@9bix.com

---

Copyright (c) 2024-2026 NINEBIX inc. All rights reserved.
