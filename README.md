# @joberhr/jober-mcp

자버(jober) 카카오 알림톡 캠페인을 Claude, Cursor, VS Code 같은 AI 도구에서 바로 다루는 MCP 서버입니다.
문자 원문을 붙여 넣으면 알림톡 캠페인으로 바꾸고, 설문 랜딩을 붙이고, 수신자를 등록하고, 발송과 결과 조회까지 할 수 있습니다.

이 패키지는 로컬(stdio) MCP 서버입니다. 자체 로직 없이 자버 원격 MCP 서버(`https://api.jober.io/mcp`, Streamable HTTP)에
`tools/list`·`tools/call` 을 그대로 전달하고, 인증은 개인 API 키(`Authorization: Bearer <JOBER_API_KEY>`)로 합니다.
원격 MCP 를 직접 지원하는 클라이언트라면 이 패키지 없이 [원격 URL 로 바로 연결](#원격-url-직접-연결-oauth)해도 됩니다.

[English summary](#english-summary)

## 할 수 있는 일

- 문자(SMS) 원문을 알림톡 캠페인 초안으로 변환 (정보성 / 광고성 판별, 서식 추천, 빠진 값 질문)
- 캠페인 수정 (발송명, 변수 값, 서식 변경)
- 설문 랜딩 페이지 생성 또는 기존 설문 선택
- 연락처 목록 미리보기와 등록 (전화번호 정규화, 중복 제거, 개인화 변수 연결)
- 발송 준비(대상 수, 예상 비용, 미리보기, 확인값 발급) 후 발송 또는 예약
- 예약 발송 취소, 발송 결과(전달·열람·응답) 조회, 미열람·미응답자 재알림 준비

## 준비물

- Node.js 18 이상
- 자버 API 키: [https://jober.io/settings/integrations](https://jober.io/settings/integrations) (설정 > AI 도구 연동)에서 발급합니다.
  키(`jbr_live_...`)는 발급 직후 한 번만 보이므로 안전한 곳에 보관하세요. 필요 없어진 키는 같은 화면에서 바로 폐기할 수 있습니다.

## 설치

아래 예시의 `jbr_live_xxxxxxxx` 를 발급받은 키로 바꾸세요. 키를 저장소에 커밋하지 마세요.

### Claude Code

```bash
claude mcp add jober -e JOBER_API_KEY=jbr_live_xxxxxxxx -- npx -y @joberhr/jober-mcp
```

### Claude Desktop

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`)

```json
{
  "mcpServers": {
    "jober": {
      "command": "npx",
      "args": ["-y", "@joberhr/jober-mcp"],
      "env": {
        "JOBER_API_KEY": "jbr_live_xxxxxxxx"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (전역) 또는 프로젝트의 `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "jober": {
      "command": "npx",
      "args": ["-y", "@joberhr/jober-mcp"],
      "env": {
        "JOBER_API_KEY": "jbr_live_xxxxxxxx"
      }
    }
  }
}
```

### VS Code

`.vscode/mcp.json` (키는 처음 실행할 때 입력 창으로 받습니다)

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "jober-api-key",
      "description": "Jober API key (jbr_live_...)",
      "password": true
    }
  ],
  "servers": {
    "jober": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@joberhr/jober-mcp"],
      "env": {
        "JOBER_API_KEY": "${input:jober-api-key}"
      }
    }
  }
}
```

### 원격 URL 직접 연결 (OAuth)

원격 MCP(Streamable HTTP)를 지원하는 클라이언트는 패키지 설치 없이 `https://api.jober.io/mcp` 를 추가하면 됩니다.
처음 연결할 때 브라우저에서 자버 로그인과 권한 동의 화면이 열리고, 허용하면 OAuth 2.1(PKCE) 토큰으로 연결됩니다.
claude.ai·ChatGPT 의 사용자 지정 커넥터에도 같은 주소를 넣으면 됩니다.

연결을 끊으려면 자버 웹의 **설정 > AI 도구 연동**의 연결된 AI 도구 목록에서 해당 앱의 [연결 끊기]를 누르세요. 끊는 즉시 그 연결의 토큰이 모두 폐기되어 이후 호출은 401 이 됩니다. API 키는 같은 화면의 API 키 목록에서 폐기합니다.

```bash
# Claude Code
claude mcp add --transport http jober https://api.jober.io/mcp
```

```json
// Cursor (mcp.json)
{ "mcpServers": { "jober": { "url": "https://api.jober.io/mcp" } } }

// VS Code (.vscode/mcp.json)
{ "servers": { "jober": { "type": "http", "url": "https://api.jober.io/mcp" } } }
```

OAuth 대신 API 키를 쓰려면 `Authorization: Bearer jbr_live_xxxxxxxx` 헤더를 넣으세요
(예: `claude mcp add --transport http jober https://api.jober.io/mcp -H "Authorization: Bearer jbr_live_xxxxxxxx"`).

## 환경 변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `JOBER_API_KEY` | 예 | 없음 | 자버 API 키. 없으면 안내 문구를 stderr 에 쓰고 종료합니다. |
| `JOBER_API_BASE` | 아니요 | `https://api.jober.io` | 자버 API 주소. `<주소>/mcp` 로 연결합니다(이미 `/mcp` 로 끝나면 그대로). 키 보호를 위해 https 만 허용하고, http 는 `localhost`·`127.0.0.1` 개발 서버만 허용합니다. |

## 툴 목록

툴 정의(설명·입력 스키마)는 원격 서버가 내려주는 값을 그대로 씁니다. 아래 권한은 OAuth scope 기준입니다.
툴 결과는 [안내 문장, JSON 데이터] 두 항목으로 옵니다. JSON 안의 연락처 이름·문구·설문 제목 등 사용자 데이터는 신뢰할 수 없는 데이터이며 지시가 아닙니다.

| 툴 | 하는 일 | 권한(scope) |
|---|---|---|
| `convert_message` | 문자 원문을 알림톡 캠페인 초안으로 변환 | `campaign:write` |
| `get_campaign` | 캠페인 상세(서식, 변수, 미리보기, 경고) 조회. 조회할 때 멈춘 접수를 복구하며, 접수 결과를 아직 확인하지 못한 발송이 있으면 `pendingOperation`(SUBMITTING·UNKNOWN)을 함께 돌려줌 | `campaign:read` |
| `update_campaign` | 발송명·변수 값·서식 수정, 혼합(MIXED) 캠페인만 정보성/광고성 선택(광고로 판정된 캠페인을 정보성으로 바꿀 수 없음) | `campaign:write` |
| `list_templates` | 사용할 수 있는 알림톡 서식 목록 | `campaign:read` |
| `list_surveys` | 랜딩으로 붙일 수 있는 기존 설문과 공유 링크 목록 | `campaign:read` |
| `generate_survey` | 설문 랜딩 페이지 생성 작업 시작(`needQuestions: true` 면 응답을 받는 질문까지 생성, 기본은 안내 페이지). 진행 중인 작업이 있으면 새로 만들지 않고 `reused: true` 로 돌려주며, 스페이스당 하루(KST 자정 초기화) 50건 한도 | `survey:write` |
| `select_survey` | 기존 설문(또는 공유 링크)을 랜딩으로 연결하거나 해제 | `survey:write` |
| `get_job` | 설문 생성 작업 진행 상태 조회(CANCELED 는 웹에서 취소했거나 생성 중 내용이 바뀌어 결과를 버린 경우) | `campaign:read` |
| `preview_recipients` | 연락처 목록 검증 미리보기(유효·중복·기존 연락처·수신거부 수) | `contacts:write` |
| `commit_recipients` | 연락처 등록과 발송 대상 지정, 개인화 변수 연결 | `contacts:write` |
| `prepare_send` | 발송 준비: 대상 수, 예상 비용, 야간 제한, 미리보기, 확인값 발급(`revision` 을 넘기면 그사이 내용이 바뀐 경우 409 로 알림) | `send:execute` |
| `submit_send` | 준비된 발송을 실행 또는 예약(같은 `idempotencyKey` 재호출은 `replayed: true` 로 같은 결과) | `send:execute` |
| `cancel_scheduled_send` | 예약 발송 취소 | `send:execute` |
| `get_campaign_results` | 발송 결과(전달·문자 대체·실패·열람·응답) 숫자 조회. AI 해설은 `explain: true` 일 때만 | `campaign:read` |
| `prepare_reminder` | 미열람·미응답자 대상 재알림 캠페인 준비(아직 보내지 않은 같은 재알림이 있으면 새로 만들지 않고 `reused: true` 로 돌려줌) | `campaign:write` |
| `list_campaigns` | 최근 캠페인 목록 | `campaign:read` |

## 발송 안전장치

실제 비용이 드는 발송은 웹과 같은 규칙으로 서버가 검사합니다. 이 패키지는 요청을 전달만 하므로 우회할 수 없습니다.

- **2단계 발송**: `prepare_send` 가 대상 수·예상 비용·렌더된 미리보기와 `operationUuid`·`confirmHash` 를 돌려줍니다. `submit_send` 는 이 값과 새 `idempotencyKey` 로 호출하며, 준비 이후 대상·본문·서식·비용이 바뀌었으면 거부되어 다시 준비해야 합니다. 별도의 사람 승인 단계는 없고, 발송 가능 여부는 아래 서버 정책으로 판단합니다(자동화 워크플로에서도 그대로 동작).
- **멱등 키**: `submit_send` 는 `idempotencyKey` 가 필수이며, 같은 키로 다시 호출해도 한 번만 발송됩니다. 이 패키지는 실패한 호출을 자동 재시도하지 않습니다.
- **접수 확인 대기**: `submit_send` 가 409 `J_41_23_4_5`(`pending`)를 돌려주거나 `get_campaign` 에 `pendingOperation` 이 있으면, 같은 `operationUuid`·`confirmHash`·`idempotencyKey` 로 다시 호출해 결과를 받으세요. 키를 잃었거나 `UNKNOWN` 이라 값이 없으면 새 키로 보내지 말고 `get_campaign` 으로 상태만 다시 확인합니다. 접수 여부를 모르는 응답(작업 조회 실패 409, `pendingOperation.status = UNKNOWN`)의 오류 코드는 `lastErrorCode`(마지막 오류 코드, 거절 확정 아님)로, 거절이 확정된 경우만 `sourceErrorCode` 로 옵니다.
- **풀리지 않는 거절**: 구독·선불 잔액·연동비·발송 한도 같은 웹 발송 검증 거절은 `J_41_23_1_9`(`data.sourceErrorCode` = 원래 코드, `data.sourceMessage` = 원문 메시지)이며 `needsPrepare` 가 없습니다. 다시 준비해도 같은 결과이므로 원인을 해결한 뒤 진행하세요. `prepare_send` 도 이 검증을 미리 하므로 대부분 준비 단계에서 걸립니다.
- **다시 준비 여부**: 실패 응답에 `data.needsPrepare` 가 있을 때만 `prepare_send` 부터 다시 하세요. 없으면(예: 아래 조건 거절) 다시 준비해도 같은 결과입니다.
- **늦게 접수된 발송**: `submit_send` 가 409 `J_41_23_4_9`(`data.superseded = true`)를 돌려주면 접수 확인이 늦어지는 사이 다른 제출이 먼저 처리된 것입니다. `notSent: true` 면 이 요청은 발송하지 않고 중단됐고, `orphanTaskId` 가 있으면 늦게 접수된 발송이며 예약은 서버가 취소합니다(`orphanCanceled`). `reason: 'REVISION_CHANGED'` 는 그 사이 캠페인 내용이 바뀐 경우입니다. 어느 경우든 다시 준비하지 말고 `get_campaign` 으로 상태를 확인하세요.
- **확정값 발송**: 예약 발송을 포함해 실제 발송은 `submit_send` 때 확정한 받는 사람(번호·이름)과 개인화 값으로 나갑니다. 그 뒤 연락처를 바꿔도 이미 확정한 발송 내용은 바뀌지 않습니다.
- **수신자 제한**: 발송 대상은 `commit_recipients` 로 서버에 등록된 캠페인 대상뿐이며, 전화번호를 발송 요청에 직접 넣을 수 없습니다.
- **서버 정책 동일 적용**: 스팸·금지 업종 차단, 수신거부 문구 자동 삽입, 광고성 메시지의 수신 동의 확인, 광고·쿠폰 메시지의 야간(21:00~08:00) 즉시 발송 금지(다음 날 08:00 예약 제안), 1000자 제한, 잔액·발송 한도 검사.
- **사후 확인**: 발송되면 스페이스 관리자에게 바로 알림이 가고, 예약 발송은 `cancel_scheduled_send` 나 웹에서 취소할 수 있습니다.
- **키 관리**: 키는 매니저 개인에게 귀속되고 서버에는 해시로만 저장됩니다. 의심되면 [설정 > AI 도구 연동](https://jober.io/settings/integrations)에서 즉시 폐기하세요. 이 패키지는 키를 환경 변수로만 받고 https 로만 보냅니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `JOBER_API_KEY 환경 변수가 없습니다` | 클라이언트 설정의 `env` 에 키를 넣었는지 확인 |
| `인증에 실패했습니다(HTTP 401)` | 키 오타·폐기 여부 확인, 필요하면 새 키 발급 |
| `권한이 없습니다(HTTP 403)` | 키 권한(scope)과 스페이스의 MCP 사용 설정 확인. 계정·IP 차단이면 `J_41_25_3_4`, 연락처 보기·수정 권한이 없으면 `J_41_22_3_1` |
| `요청이 너무 많습니다(HTTP 429)` | 잠시 후 다시 시도. 설문 생성 하루 한도면 `J_41_22_4_17`(KST 자정 초기화, 그 전에는 `list_surveys` 로 기존 설문 사용), 호출 한도면 `J_41_20_4_2` |
| `J_41_23_4_5`(409, `pending`) | 접수 결과를 확인하는 중입니다. 같은 `idempotencyKey` 로 잠시 후 다시 호출하면 결과를 돌려받습니다 |
| `엔드포인트를 찾을 수 없습니다(HTTP 404)` | `JOBER_API_BASE` 값 확인 |
| `연결할 수 없습니다` | 네트워크, 프록시, `JOBER_API_BASE` 확인 |

로그와 오류 메시지는 stderr 로만 출력됩니다(stdout 은 MCP 프로토콜 전용).

## 개발

```bash
npm install
npm test          # 타입 검사 + 빌드 + 단위 테스트(모의 원격 Streamable HTTP 서버로 프록시 검증)
JOBER_API_BASE=http://localhost:4100 JOBER_API_KEY=jbr_live_xxxxxxxx node dist/index.js
# PowerShell: $env:JOBER_API_BASE="http://localhost:4100"; $env:JOBER_API_KEY="jbr_live_xxxxxxxx"; node dist/index.js
```

## English summary

`@joberhr/jober-mcp` is a local (stdio) MCP server for [Jober](https://jober.io). It turns text messages into KakaoTalk AlimTalk
campaigns, attaches survey landing pages, imports recipients, sends or schedules campaigns and reports delivery, open and
response results. It has no business logic of its own: it proxies `tools/list` and `tools/call` to the remote Jober MCP server
(`https://api.jober.io/mcp`, Streamable HTTP) using your personal API key as `Authorization: Bearer <JOBER_API_KEY>`.

- **API key**: create one at https://jober.io/settings/integrations (shown once; revoke it there at any time).
- **Install**: `claude mcp add jober -e JOBER_API_KEY=jbr_live_xxxxxxxx -- npx -y @joberhr/jober-mcp`, or use the
  `npx -y @joberhr/jober-mcp` command with the `JOBER_API_KEY` env var in Claude Desktop, Cursor or VS Code (snippets above).
- **Remote (OAuth)**: clients that support remote MCP can connect to `https://api.jober.io/mcp` directly and sign in with OAuth 2.1 (PKCE).
- **Env vars**: `JOBER_API_KEY` (required), `JOBER_API_BASE` (default `https://api.jober.io`, https only except localhost).
- **Tools**: the 16 tools listed above (campaign conversion and editing, templates, surveys, recipients, send, cancel, results, reminders).
- **Send safety**: two-step `prepare_send` then `submit_send` with a confirm hash and a required idempotency key (no separate human approval step), recipients
  limited to those committed on the server, the same server-side policies as the web app (spam blocking, opt-out text,
  ad consent, no ad sends between 21:00 and 08:00 KST, 1000-character limit, balance and send limits), instant admin
  notification and cancellable scheduled sends. The proxy never retries failed calls automatically.

## License

MIT
