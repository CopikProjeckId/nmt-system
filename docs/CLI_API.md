# NMT CLI API Reference

CLI 명령어와 검증 스키마에 대한 상세 문서입니다.

## 목차

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

순방향 추론 (원인 → 결과)

```bash
nmt infer forward <neuron-id> [--depth N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 | 설명 |
|---------|------|------|-------|------|------|
| neuronId | uuid | ✓ | - | - | 시작 뉴런 ID |
| depth | number | | 3 | 1-10 | 추론 깊이 |

**예시:**
```bash
nmt infer forward neuron-abc123 --depth 5
```

---

### `nmt infer backward`

역방향 추론 (결과 → 원인, 귀납법)

```bash
nmt infer backward <neuron-id> [--depth N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 | 설명 |
|---------|------|------|-------|------|------|
| neuronId | uuid | ✓ | - | - | 관찰 뉴런 ID |
| depth | number | | 3 | 1-10 | 추론 깊이 |

---

### `nmt infer causal`

두 뉴런 간 인과 관계 탐색

```bash
nmt infer causal <from-id> <to-id>
```

**Schema:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| fromId | uuid | ✓ | 시작 뉴런 ID |
| toId | uuid | ✓ | 도착 뉴런 ID |

---

### `nmt infer bidirectional`

양방향 추론

```bash
nmt infer bidirectional <neuron-id> [--depth N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 |
|---------|------|------|-------|------|
| neuronId | uuid | ✓ | - | - |
| depth | number | | 3 | 1-10 |

---

## Learning Commands

### `nmt learn extract`

뉴런에서 의미 있는 내용 추출

```bash
nmt learn extract <neuron-id> [--limit N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 | 설명 |
|---------|------|------|-------|------|------|
| neuronId | uuid | ✓ | - | - | 대상 뉴런 ID |
| limit | number | | 10 | 1-100 | 결과 제한 수 |

---

### `nmt learn session`

학습 세션 관리

```bash
nmt learn session <action>
```

**Schema:**
| 파라미터 | 타입 | 필수 | 허용값 |
|---------|------|------|-------|
| action | string | ✓ | `start`, `end` |

---

## Dimension Commands

### `nmt dimension register`

새 차원 등록

```bash
nmt dimension register <name> [--category "..."] [--description "..."]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 |
|---------|------|------|-------|------|
| name | string | ✓ | - | 1-100자 |
| category | string | | "custom" | 최대 50자 |
| description | string | | "" | 최대 500자 |

---

### `nmt dimension category`

카테고리별 차원 조회

```bash
nmt dimension category <category-name> [--limit N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 |
|---------|------|------|-------|------|
| category | string | ✓ | - | 1-50자 |
| limit | number | | 20 | 1-100 |

---

## Orchestrate Commands

### `nmt orchestrate infer`

통합 추론 (모든 모듈 결합)

```bash
nmt orchestrate infer <neuron-id> [--depth N] [--no-attractors] [--no-probabilistic]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 |
|---------|------|------|-------|------|
| neuronId | uuid | ✓ | - | - |
| depth | number | | 3 | 1-10 |
| noAttractors | boolean | | false | - |
| noProbabilistic | boolean | | false | - |

---

### `nmt orchestrate learn`

상호작용 학습

```bash
nmt orchestrate learn --input "..." --output "..." [--success] [--feedback N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 |
|---------|------|------|-------|------|
| input | string | ✓ | - | 최소 1자 |
| output | string | ✓ | - | 최소 1자 |
| success | boolean | | false | - |
| feedback | number | | 0.8/0.2 | 0-1 |
| inputNeuron | uuid | | - | - |
| outputNeuron | uuid | | - | - |

---

### `nmt orchestrate feedback`

피드백 제공

```bash
nmt orchestrate feedback --input-neuron <id> --output-neuron <id> --quality N
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 |
|---------|------|------|-------|------|
| inputNeuron | uuid | ✓ | - | - |
| outputNeuron | uuid | ✓ | - | - |
| quality | number | | 0.5 | 0-1 |
| text | string | | "" | - |

---

### `nmt orchestrate reinforce`

성공 경로 강화

```bash
nmt orchestrate reinforce --from <id> --to <id> [--strength N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 |
|---------|------|------|-------|------|
| from | uuid | ✓ | - | - |
| to | uuid | ✓ | - | - |
| strength | number | | 0.1 | 0-1 |

---

## System Commands

### `nmt prob metrics`

시스템 메트릭 조회

```bash
nmt prob metrics
```

**출력 포함:**
- Uptime, Timestamp
- Counters (요청 수, 학습 횟수 등)
- Gauges (활성 연결 등)
- Histograms (지연 시간 분포)
- Health Status

---

### `nmt prob prometheus`

Prometheus 형식으로 메트릭 출력

```bash
nmt prob prometheus
```

---

### `nmt prob health`

시스템 헬스 체크

```bash
nmt prob health
```

---

## Sync Commands

### `nmt sync status`

동기화 상태 확인

```bash
nmt sync status [--json]
```

**출력 정보:**
- Node ID
- 현재 시퀀스 번호
- Merkle Root
- Vector Clock
- 마지막 동기화 시간
- 연결된 피어 수

**예시 출력:**
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

변경 로그 조회

```bash
nmt sync changes [--from N] [--limit N]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 | 설명 |
|---------|------|------|-------|------|------|
| from | number | | 0 | 0+ | 시작 시퀀스 |
| limit | number | | 50 | 1-1000 | 최대 결과 수 |

**예시:**
```bash
nmt sync changes --from 10 --limit 100
```

---

### `nmt sync export`

상태 내보내기 (JSON 백업)

```bash
nmt sync export [--output <path>]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|-------|------|
| output | string | | sync-state.json | 출력 파일 경로 |

**예시:**
```bash
nmt sync export --output ./backups/state-2025-02-27.json
```

**내보내기 내용:**
- version: 파일 형식 버전
- exportedAt: 내보내기 시간
- state: 노드 상태 (nodeId, sequence, merkleRoot, vectorClock)
- changes: 전체 변경 로그
- peers: 피어 목록

---

### `nmt sync import`

상태 가져오기 (복원)

```bash
nmt sync import <file>
```

**Schema:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| file | string | ✓ | JSON 파일 경로 (확장자 .json 필수) |

**예시:**
```bash
nmt sync import ./backups/state-2025-02-27.json
```

**보안:**
- 경로 순회 공격 방지 (sanitized paths)
- .json 확장자만 허용

---

### `nmt sync peers`

연결된 피어 목록

```bash
nmt sync peers [--json]
```

**출력 정보:**
- Peer ID
- Endpoint (URL)
- 연결 상태 (connected/disconnected)
- 마지막 확인 시간
- 마지막 시퀀스

---

### `nmt sync journal`

저널 통계 조회

```bash
nmt sync journal [--json]
```

**출력 정보:**
- 총 엔트리 수
- 가장 오래된 시퀀스
- 최신 시퀀스
- 분당 평균 엔트리 수

---

## Attractor Commands

### `nmt attractor create`

목표 끌개 생성

```bash
nmt attractor create <name> [--description "..."] [--strength N] [--priority N] [--deadline DATE]
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 범위 | 설명 |
|---------|------|------|-------|------|------|
| name | string | ✓ | - | 1-200자 | 끌개 이름 |
| description | string | | "" | 최대 1000자 | 설명 |
| strength | number | | 0.5 | 0-1 | 끌어당기는 힘 |
| priority | number | | 5 | 1-10 | 우선순위 |
| deadline | string | | - | ISO 8601 | 마감일 |

**예시:**
```bash
nmt attractor create "프로젝트 완료" \
  --description "MVP 개발 및 배포" \
  --strength 0.9 \
  --priority 10 \
  --deadline 2025-03-31
```

---

### `nmt attractor list`

끌개 목록 조회

```bash
nmt attractor list [--limit N]
```

---

### `nmt attractor path`

현재 상태에서 목표까지 경로 계산

```bash
nmt attractor path <neuron-id> <attractor-id>
```

**Schema:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| neuronId | uuid | ✓ | 현재 상태 뉴런 ID |
| attractorId | uuid | ✓ | 목표 끌개 ID |

**출력 정보:**
- 경로 확률
- 단계별 경로
- 병목 지점

---

### `nmt attractor influence`

특정 뉴런에 대한 끌개 영향력 조회

```bash
nmt attractor influence <neuron-id>
```

**출력 정보:**
- 각 끌개별 영향력 점수
- 지배적 끌개

---

## Verify Commands

### `nmt verify neuron`

뉴런 무결성 검증

```bash
nmt verify neuron <neuron-id>
```

**출력:**
- valid: true/false
- merkleRoot: 현재 머클 루트
- 검증 시간

---

### `nmt verify proof`

Merkle 증명 생성

```bash
nmt verify proof <neuron-id> --index N
```

**Schema:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| neuronId | uuid | ✓ | 뉴런 ID |
| index | number | ✓ | 리프 인덱스 |

---

### `nmt verify batch`

배치 증명 (여러 리프 동시)

```bash
nmt verify batch <neuron-id> --indices 0,2,5
```

**Schema:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| neuronId | uuid | ✓ | 뉴런 ID |
| indices | string | ✓ | 쉼표로 구분된 인덱스 |

---

### `nmt verify diff`

두 뉴런 간 Merkle 트리 차이 비교

```bash
nmt verify diff <neuron-id-1> <neuron-id-2>
```

**출력:**
- 추가된 해시
- 삭제된 해시
- 수정된 항목

---

### `nmt verify range`

범위 증명 생성

```bash
nmt verify range <neuron-id> --start N --end M
```

**Schema:**
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|-------|------|
| neuronId | uuid | ✓ | - | 뉴런 ID |
| start | number | ✓ | - | 시작 인덱스 |
| end | number | ✓ | - | 종료 인덱스 |

---

## 검증 오류

검증 실패 시 다음 형식으로 오류가 반환됩니다:

```
Validation Error:
  - field: 오류 메시지
  - field2: 오류 메시지
```

### 일반 오류 유형

| 오류 | 설명 |
|-----|------|
| `is required` | 필수 파라미터 누락 |
| `must be between X and Y` | 범위 초과 |
| `must be one of: [...]` | enum 값 불일치 |
| `must be at least N characters` | 최소 길이 미달 |
| `must not exceed N characters` | 최대 길이 초과 |
| `must match pattern` | 정규식 불일치 |

---

*마지막 업데이트: 2025년 2월*
