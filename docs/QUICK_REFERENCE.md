# NMT 빠른 참조 카드

## 서버 시작/종료

```bash
# 백엔드 시작
cd d:\AI\nmt-system && npm run dev

# 대시보드 시작
cd d:\AI\nmt-system\dashboard && npm run dev

# 종료: Ctrl + C
```

## 주요 URL

| 서비스 | URL |
|--------|-----|
| 백엔드 API | http://localhost:3000 |
| 대시보드 | http://localhost:5173 |
| API 상태 확인 | http://localhost:3000/api/v1/health |

---

## API 빠른 사용법

### 텍스트 저장
```bash
curl -X POST http://localhost:3000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "저장할 텍스트"}'
```

### 검색
```bash
curl -X POST http://localhost:3000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "찾을 내용", "k": 10}'
```

### 통계 보기
```bash
curl http://localhost:3000/api/v1/stats
```

### 뉴런 보기
```bash
curl http://localhost:3000/api/v1/neurons/뉴런ID
curl http://localhost:3000/api/v1/neurons/뉴런ID/content
```

### 검증
```bash
curl http://localhost:3000/api/v1/verify/뉴런ID
```

---

## 클러스터링

### K-means
```bash
curl -X POST http://localhost:3000/api/v1/clusters/kmeans \
  -H "Content-Type: application/json" \
  -d '{"k": 5}'
```

### DBSCAN
```bash
curl -X POST http://localhost:3000/api/v1/clusters/dbscan \
  -H "Content-Type: application/json" \
  -d '{"eps": 0.3, "minPts": 3}'
```

### 클러스터 조회
```bash
curl http://localhost:3000/api/v1/clusters
```

---

## 문제 해결

### 서버 안 켜짐 (LEVEL_LOCKED)
```bash
# Windows
taskkill /F /IM node.exe
rm -rf data
npm run dev
```

### 포트 충돌
```bash
# 사용 중인 포트 확인
netstat -ano | grep :3000

# 해당 프로세스 종료 (Windows)
taskkill /F /PID 프로세스ID
```

---

## API 엔드포인트 요약

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 텍스트 저장 | POST | `/api/v1/ingest` |
| 배치 저장 | POST | `/api/v1/ingest/batch` |
| 검색 | POST | `/api/v1/search` |
| 유사 뉴런 | GET | `/api/v1/search/similar/:id` |
| 뉴런 목록 | GET | `/api/v1/neurons` |
| 뉴런 상세 | GET | `/api/v1/neurons/:id` |
| 뉴런 내용 | GET | `/api/v1/neurons/:id/content` |
| 뉴런 삭제 | DELETE | `/api/v1/neurons/:id` |
| 연결 생성 | POST | `/api/v1/synapses` |
| 연결 삭제 | DELETE | `/api/v1/synapses/:id` |
| 검증 | GET | `/api/v1/verify/:id` |
| 전체 검증 | GET | `/api/v1/verify` |
| 그래프 탐색 | POST | `/api/v1/graph/traverse` |
| 경로 찾기 | POST | `/api/v1/graph/path` |
| 서브그래프 | GET | `/api/v1/graph/subgraph/:id` |
| K-means | POST | `/api/v1/clusters/kmeans` |
| DBSCAN | POST | `/api/v1/clusters/dbscan` |
| 계층 클러스터 | POST | `/api/v1/clusters/hierarchical` |
| 클러스터 목록 | GET | `/api/v1/clusters` |
| 토픽 추출 | POST | `/api/v1/topics/extract` |
| Louvain | POST | `/api/v1/communities/louvain` |
| 라벨 전파 | POST | `/api/v1/communities/label-propagation` |
| 통계 | GET | `/api/v1/stats` |
| 상태 | GET | `/api/v1/health` |
