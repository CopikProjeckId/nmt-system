# NMT MCP 서버 설정 가이드

NMT를 MCP(Model Context Protocol) 서버로 실행하여 Claude Desktop, OpenClaw 등에서 사용할 수 있습니다.

---

## 1. 설치

```bash
cd d:\AI\nmt-system
npm install
```

## 2. Claude Desktop 설정

### Windows

`%APPDATA%\Claude\claude_desktop_config.json` 파일을 편집합니다:

```json
{
  "mcpServers": {
    "nmt": {
      "command": "npx",
      "args": ["tsx", "d:/AI/nmt-system/src/mcp/server.ts"],
      "env": {
        "NMT_DATA_DIR": "d:/AI/nmt-system/data"
      }
    }
  }
}
```

### macOS

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nmt": {
      "command": "npx",
      "args": ["tsx", "/path/to/nmt-system/src/mcp/server.ts"],
      "env": {
        "NMT_DATA_DIR": "/path/to/nmt-system/data"
      }
    }
  }
}
```

## 3. Claude Desktop 재시작

설정 후 Claude Desktop을 완전히 종료하고 다시 시작합니다.

---

## 사용 가능한 도구

Claude에서 다음 도구들을 사용할 수 있습니다:

### nmt_save
텍스트를 저장합니다.
```
"이 내용을 NMT에 저장해줘: 오늘 회의에서 논의된 내용..."
```

### nmt_search
의미 기반 검색을 합니다.
```
"NMT에서 '프로젝트 일정' 관련 내용 찾아줘"
```

### nmt_get
특정 뉴런의 내용을 가져옵니다.
```
"NMT에서 ID가 abc123인 뉴런 내용 보여줘"
```

### nmt_verify
데이터 무결성을 검증합니다.
```
"이 데이터가 변조되지 않았는지 확인해줘"
```

### nmt_connect
뉴런들을 연결합니다.
```
"이 두 뉴런을 연결해줘"
```

### nmt_related
관련 뉴런을 찾습니다.
```
"이 뉴런과 관련된 다른 내용들 찾아줘"
```

### nmt_stats
시스템 통계를 보여줍니다.
```
"NMT 현재 상태 알려줘"
```

### nmt_cluster
뉴런들을 클러스터링합니다.
```
"저장된 내용들을 5개 그룹으로 분류해줘"
```

---

## 사용 예시

### 지식 저장
```
사용자: "오늘 배운 내용을 NMT에 저장해줘:
        Python의 리스트 컴프리헨션은 [x for x in range(10)]처럼 사용한다."

Claude: nmt_save 도구를 사용하여 저장했습니다.
        뉴런 ID: abc123...
```

### 지식 검색
```
사용자: "Python 리스트 관련해서 내가 저장한 게 있었는데, 찾아줘"

Claude: nmt_search 도구로 검색한 결과:
        1. (유사도 0.92) "Python의 리스트 컴프리헨션은..."
        2. (유사도 0.85) "Python 리스트 메서드..."
```

### 데이터 검증
```
사용자: "이 자료가 원본 그대로인지 확인해줘"

Claude: nmt_verify 도구로 검증한 결과:
        ✓ 데이터가 검증되었습니다. 위변조되지 않았습니다.
        머클 루트: def456...
```

---

## OpenClaw 연동

OpenClaw에서 NMT MCP 서버를 사용하려면:

```bash
# OpenClaw 시작 시 MCP 서버 지정
openclaw --mcp-server "npx tsx d:/AI/nmt-system/src/mcp/server.ts"
```

또는 OpenClaw 설정 파일에 추가:

```yaml
# ~/.openclaw/config.yaml
mcp_servers:
  - name: nmt
    command: npx
    args:
      - tsx
      - d:/AI/nmt-system/src/mcp/server.ts
    env:
      NMT_DATA_DIR: d:/AI/nmt-system/data
```

---

## 문제 해결

### MCP 서버가 시작되지 않음
```bash
# 직접 실행해서 오류 확인
cd d:\AI\nmt-system
npm run mcp
```

### 데이터베이스 잠금 오류
```bash
# 기존 서버 종료
taskkill /F /IM node.exe

# data 폴더 정리
rm -rf data
mkdir data

# 다시 시작
npm run mcp
```

### 도구가 보이지 않음
Claude Desktop을 완전히 종료 후 재시작하세요.
설정 파일 경로와 JSON 문법을 확인하세요.
