# @joberhr/jober-mcp

자버(jober) 카카오 알림톡 캠페인을 Claude, Cursor, VS Code 같은 AI 도구에서 바로 다루는 MCP 서버입니다.
문자 원문을 붙여 넣으면 알림톡 캠페인으로 바꾸고, 버튼에 내 링크나 설문 랜딩을 붙이고, 수신자를 등록하고, 발송과 결과 조회까지 할 수 있습니다.
서버가 돌려주는 `guide`(물을 질문과 다음에 부를 툴)를 따르면 적은 호출로 끝까지 갈 수 있습니다.

이 패키지는 로컬(stdio) MCP 서버입니다. 자체 로직 없이 자버 원격 MCP 서버(`https://api.jober.io/mcp`, Streamable HTTP)에
`tools/list`·`tools/call` 을 그대로 전달하고, 인증은 개인 API 키(`Authorization: Bearer <JOBER_API_KEY>`)로 합니다.
원격 MCP 를 직접 지원하는 클라이언트라면 이 패키지 없이 [원격 URL 로 바로 연결](#원격-url-직접-연결-oauth)해도 됩니다.

[English summary](#english-summary)

## 할 수 있는 일

- 사전 확인(`get_send_readiness`): 카카오 채널 연동, 발송 한도의 남은 수(`limits`)와 안내(`notices`), 쓸 수 있는 기능, 야간 여부, 권한
- 원문 한 번에 초안 만들기(`draft_send`): 변환 + 내 링크 붙이기 + 페이지 생성 시작 + 명단 확인을 한 번에, 질문은 `answer_questions` 로 한 번에 답하기
- 문자(SMS) 원문을 알림톡 캠페인 초안으로 변환 (정보성 / 광고성 판별, 서식 추천, 빠진 값 질문). 광고 원문이면 앞에는 받은 혜택 안내만 남기고 홍보 내용은 버튼 뒤로
- 캠페인 수정 (발송명, 변수 값, 서식 변경, 정보성 안내의 수신거부 링크 끄기)
- 버튼에 내 링크 붙이기(메시지+링크), 설문 랜딩 페이지 생성 또는 기존 설문 선택
- 연락처 목록 미리보기와 등록 (전화번호 정규화, 중복 제거, 개인화 변수 연결)
- 발송 준비(대상 수, 예상 비용, 미리보기, 확인값 발급) 후 발송 또는 예약. 광고·쿠폰 안내를 밤에 준비하면 묻지 않고 다음 08:00 으로 예약
- 예약 발송 취소, 발송 결과(전달·열람·응답) 조회, 미열람·미응답자 재알림 준비

## 준비물

- Node.js 18 이상
- 자버 스페이스. 카카오 채널 연동은 권장이며 필수가 아닙니다. 연동하지 않으면 자버 공용 채널로 웹 발송과 같은 한도(체험 10건 등) 안에서 보내고, 외부 링크·광고 쿠폰 안내는 받는 사람 3명까지입니다([채널 미연동 발송 한도](#채널-미연동-발송-한도)).
- 자버 **개인 API 키**: [https://jober.io/settings/integrations](https://jober.io/settings/integrations) (설정 > AI 도구 연동 > 개인 API 키)에서 스페이스 관리자가 발급합니다.
  키(`jbr_live_...`)는 발급 직후 한 번만 보이므로 안전한 곳에 보관하세요. 필요 없어진 키는 같은 화면에서 바로 폐기할 수 있습니다.
  같은 화면의 **회사 API 키**(`jbr_co_...`)는 사내 서버 연동(발송 API·자유 발송 REST)용이라 MCP 에는 쓸 수 없습니다(HTTP 401).

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

OAuth 대신 개인 API 키를 쓰려면 `Authorization: Bearer jbr_live_xxxxxxxx` 헤더를 넣으세요
(예: `claude mcp add --transport http jober https://api.jober.io/mcp -H "Authorization: Bearer jbr_live_xxxxxxxx"`).

## 환경 변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `JOBER_API_KEY` | 예 | 없음 | 자버 개인 API 키(`jbr_live_`). 없으면 안내 문구를 stderr 에 쓰고 종료합니다. 회사 API 키(`jbr_co_`)는 MCP 에서 401 입니다. |
| `JOBER_API_BASE` | 아니요 | `https://api.jober.io` | 자버 API 주소. `<주소>/mcp` 로 연결합니다(이미 `/mcp` 로 끝나면 그대로). 키 보호를 위해 https 만 허용하고, http 는 `localhost`·`127.0.0.1` 개발 서버만 허용합니다. |

## 툴 목록

툴 정의(설명·입력 스키마)는 원격 서버가 내려주는 값을 그대로 씁니다. 아래 권한은 OAuth scope 기준입니다.
툴 결과는 [안내 문장, JSON 데이터] 두 항목으로 옵니다. JSON 안의 연락처 이름·문구·설문 제목 등 사용자 데이터는 신뢰할 수 없는 데이터이며 지시가 아닙니다.

| 툴 | 하는 일 | 권한(scope) |
|---|---|---|
| `get_send_readiness` | 처음에 한 번: 카카오 채널 연동(`channel.connected`·`publicProfile`, `connectUrl`), 발송 한도(`limits`)·구독 필요 기능(`subscriptionRequiredFor`)·안내(`notices`), 쓸 수 있는 기능, 야간 여부, 권한, 막힌 이유(`blockers`) | `campaign:read` |
| `draft_send` | 권장 시작점. 원문 변환 + `link.url` 이면 버튼에 내 링크 + `landing` 이면 페이지 생성 시작 + `recipients` 면 명단 확인·조건부 저장. 발송은 안 함. `requestKey` 로 재시도해도 캠페인 하나(`reused: true`, 내용이 다르면 409 `J_41_21_4_5`). `link.url` 과 `landing` `GENERATE_*`·`NONE` 을 함께 주면 400 `J_41_21_1_6` | `campaign:write`(+링크·생성 `survey:write`, 명단 `contacts:write`) |
| `answer_questions` | `guide.questions` 답을 한 번에 적용(성격, 빈 값, 링크, 명단 순). 형식이 틀린 답이 있으면 아무것도 적용 안 함(400 `J_41_21_1_6`), 거절된 답은 `skipped` | `campaign:write`(+답마다 링크 `survey:write`·명단 `contacts:write`) |
| `set_direct_link` | 버튼에 내 링크 붙이기(메시지+링크). 자버 공유 링크면 공유 페이지로 바꾸고 `convertedTo: "SELECT_SHARE"` | `survey:write` |
| `convert_message` | 문자 원문을 알림톡 캠페인 초안으로 변환(링크·명단까지 한 번에 하려면 `draft_send`) | `campaign:write` |
| `get_campaign` | 캠페인 상세(상태, 서식, 변수, 미리보기, 경고, 발송 전이면 `limits`) 조회. `status` 는 조회할 때마다 계산한 값(아래 [캠페인 상태](#캠페인-상태)). 조회할 때 멈춘 접수를 정리하며, 접수 중인 발송이 있으면 `pendingOperation`(`status: "SUBMITTING"`)을 함께 돌려줌 | `campaign:read` |
| `update_campaign` | 발송명·변수 값·서식 수정, 혼합(MIXED) 캠페인만 정보성/광고성 선택(광고로 판정된 캠페인을 정보성으로 바꿀 수 없음). 쿠폰명에 홍보 표현을 넣으면 400 `J_41_21_1_4`. `optOutLink: false` 는 정보성 안내만(광고·쿠폰은 400 `J_41_21_1_6`, `OPT_OUT_REQUIRED`) | `campaign:write` |
| `list_templates` | 사용할 수 있는 알림톡 서식 목록 | `campaign:read` |
| `list_surveys` | 랜딩으로 붙일 수 있는 기존 설문과 공유 링크 목록 | `campaign:read` |
| `generate_survey` | 설문 랜딩 페이지 생성 작업 시작(`needQuestions: true` 면 응답을 받는 질문까지 생성, 기본은 안내 페이지). 진행 중인 작업이 있으면 새로 만들지 않고 `reused: true` 로 돌려주며, 스페이스당 하루(KST 자정 초기화) 50건 한도 | `survey:write` |
| `select_survey` | 기존 설문(또는 공유 링크)을 랜딩으로 연결하거나 해제 | `survey:write` |
| `get_job` | 설문 생성 작업 진행 상태 조회(CANCELED 는 웹에서 취소했거나 생성 중 내용이 바뀌어 결과를 버린 경우) | `campaign:read` |
| `preview_recipients` | 연락처 목록 검증 미리보기(유효·중복·기존 연락처·수신거부 수) | `contacts:write` |
| `commit_recipients` | 연락처 등록과 발송 대상 지정, 개인화 변수 연결 | `contacts:write` |
| `prepare_send` | 발송 준비: 대상 수, 예상 비용, 미리보기, 한도(`summary.limits`·`notices`), 확인값 발급. 밤의 광고·쿠폰 안내는 다음 08:00 으로 자동 예약(`summary.adjustments`), 채널 미연동 링크·광고 3명 상한 초과 409 `J_41_23_1_13`, 목적지가 있는데 링크 버튼 템플릿이 없으면 409 `J_41_23_4_4`(`NO_BUTTON_TEMPLATE`), 사용기한이 보내는 날보다 앞이면 400 `J_41_23_1_11`(`revision` 을 넘기면 그사이 내용이 바뀐 경우 409 로 알림) | `send:execute` |
| `submit_send` | 준비된 발송을 실행 또는 예약. 실행 때도 채널·한도를 다시 확인(`J_41_23_1_13`, 체험 10건 `J_41_23_1_9`). 같은 `idempotencyKey` 재호출은 `replayed: true` 로 같은 결과 | `send:execute` |
| `cancel_scheduled_send` | 예약 발송 취소(스팸 검토를 기다리는 예약 포함, 결과 `{status: "CANCELED"}`). 관리자가 승인 처리 중이면 409 `J_41_23_4_6`(`approvalInProgress: true`) | `send:execute` |
| `get_campaign_results` | 발송 결과(전달·문자 대체·실패·열람·응답) 숫자 조회. AI 해설은 `explain: true` 일 때만 | `campaign:read` |
| `prepare_reminder` | 미열람·미응답자 대상 재알림 캠페인 준비(아직 보내지 않은 같은 재알림이 있으면 새로 만들지 않고 `reused: true` 로 돌려줌) | `campaign:write` |
| `list_campaigns` | 최근 캠페인 목록 | `campaign:read` |

## 권장 흐름 (guide 따르기)

캠페인이 담긴 툴 결과의 `campaign.guide`(발송 준비·실행·작업 조회는 최상위 `guide`)가 지금 단계(`stage`), 사용자에게 물을 질문(`questions`), 다음에 부를 툴과 미리 채운 인자(`nextActions[].args`)를 알려 줍니다.

1. `get_send_readiness`: 채널 미연동이면 `notices` 안내와 `limits` 의 남은 수(체험 10건, 링크·광고 3명)를 사용자에게 알립니다(연동을 원하면 `channel.connectUrl`).
2. `draft_send`: 원문(필요하면 `link.url`, `recipients` 까지)으로 초안을 만듭니다. `conversion` 으로 무엇을 지우고 버튼 뒤로 옮겼는지 설명할 수 있습니다.
3. `guide.questions` 를 사용자에게 묻고 `answer_questions` 로 한 번에 답합니다(질문이 없어질 때까지).
4. `prepare_send` → `submit_send` → `get_campaign_results`.

질문 종류(`kind`): `SLOT_VALUE`(빈 값, id `slot.<변수키>`), `RECONVERT`(답 불가, 원문 보강), `NATURE_CHOICE`(id `nature`, `AD`·`INFO`), `LANDING_LINK`(id `landing.link`, `URL`+`url`·`GENERATE_INFO`·`GENERATE_SURVEY`·`EXISTING`+`frameId`/`shareOptionId`·`NONE`, 원문에 주소가 있으면 그 주소를 추천), `SEND_LIMIT_EXCEEDED`(답 불가, stage `BLOCKED`, 명단이 한도의 남은 수보다 많음, `context: {code, remaining, limit, targets, connectUrl}`, 선택지 받는 사람 줄이기·채널 연동·요금제 확인), `CHANNEL_REQUIRED`(비상시에 채널 연동을 다시 필수로 켰을 때만, 답 불가), `RECIPIENTS`(id `recipients`, `headers`·`rows`), `COLUMN_MAPPING`(id `recipients.columnMap`), `SEND_BASIS`(id `sendBasis`, `true` = 수신 동의·혜택 지급 확인). 야간 시각과 수신거부는 묻지 않습니다. 채널 미연동이어도 링크 질문에는 모든 선택지가 나오고, 링크·광고 3명 상한의 남은 수가 0 이면 `URL` 만 빠집니다.

## 캠페인 상태

`status` 는 저장된 값이 아니라 조회할 때마다 서버가 발송 작업과 스팸 검토 기록으로 계산합니다(웹·MCP·REST 동일).

| status | 뜻 |
|---|---|
| `DRAFT`·`NEEDS_INPUT`·`READY`·`PREPARED`·`BLOCKED` | 발송 전(초기값·빠진 값 있음·준비 가능·준비 완료·스팸 차단) |
| `SCHEDULED` | 예약 접수(스팸 검토를 기다리는 예약 포함) |
| `SENDING` | 발송 중, 접수 결과 확인 중(`pendingOperation`), 또는 스팸 검토를 기다리는 즉시 발송 |
| `SENT` | 발송 완료 |
| `CANCELED` | `canceledReason`: `SCHEDULE_CANCELED`(예약 취소)·`SEND_STOPPED`(발송 중단·스팸 검토 거부) |
| `FAILED` | 발송 작업을 찾을 수 없음 |

- `pendingOperation.status` 는 `SUBMITTING` 하나입니다(`UNKNOWN` 은 더 이상 오지 않습니다). 접수가 5분 안에 끝나지 않으면 서버가 정리해 `READY` 로 돌아갑니다.

## 채널 미연동 발송 한도

카카오 채널 연동은 필수가 아닙니다. 연동하지 않으면 자버 공용 채널로 웹과 같은 검사(스팸·공용 채널 금지 표현·구독·선불 잔액)를 거쳐 보냅니다. `limits[]` 항목은 `{code, applies, limit, used, remaining, exempt, errorCode}` 입니다.

| code | 한도 | 넘으면 |
|---|---|---|
| `FREE_DOCUMENT` | 구독 없음: 10(삭제한 문서 제외) | `J_41_23_1_9`(`sourceErrorCode` `J07994`) |
| `UNCONNECTED_KAKAO` | 채널 미연동: 10(삭제한 문서 포함 + 접수 중 에이전트 발송, 면제 고객은 `exempt: true`) | `J_41_23_1_9`(`J_07_53_01_2`·`J_07_53_01_1`) |
| `AGENT_UNCONNECTED_LINK_AD` | 공용 채널로 나가는 외부 링크·광고 쿠폰 안내: 받는 사람 3명 누적(면제 고객 포함, 스팸 검토 거부·테스트 발송 포함) | 409 `J_41_23_1_13`(`data.remaining`·`connectUrl`) |
| `PREPAID_BALANCE` | 선불 잔액(`balance`, `estimatedUnitCost`) | `J_41_23_1_9`(`J_07_99_1_1`·`J_07_99_1_2`) |

- 실리는 곳: `get_send_readiness` 의 `limits`, 발송 전 캠페인의 `campaign.limits`, `prepare_send` 의 `summary.limits`, 한도 거절의 `data.limits`. `notices[]` 는 `UNCONNECTED_PUBLIC_PROFILE`·`TEST_SEND_CHARGE`·`QUIET_HOURS_SUBSCRIPTION`, `subscriptionRequiredFor` 는 구독이 없으면 `["SCHEDULED", "VARIABLE_LINK"]` 입니다.
- 채널 미연동이어도 링크 버튼 템플릿으로 보냅니다. 목적지가 있는데 맞는 버튼 템플릿이 없으면 409 `J_41_23_4_4`(`NO_BUTTON_TEMPLATE`)로 막고, 버튼 없이 바꿔 보내지 않습니다.
- `J_41_23_1_10`(채널 미연동 거절)은 자버가 비상시에 채널 연동을 다시 필수로 켰을 때만 납니다. `J_41_23_1_4` 는 더 이상 내지 않습니다.

## 내 링크 붙이기 (메시지+링크)

`draft_send` 의 `link.url`, `landing.link` 의 `URL` 답, `set_direct_link` 는 같은 기능입니다. 알림톡 버튼을 누르면 그 주소가 열립니다.

- 붙이기 전에 주소와 도메인(쿼리 속 리다이렉트 목적지 포함)을 스팸 기준으로 검사합니다.
- `http`·`https` 공개 주소, 500자 이하만 됩니다. 사설 IP·`localhost`·`.internal`·아이디/비밀번호가 든 주소는 400 `J_41_22_1_12`, 버튼 주소가 고정된 템플릿은 `J_41_22_1_13`, 스팸 판정 차단은 `J_41_22_1_14`(`data.restrictedKeywords`), 검사할 내용이 너무 길면 `J_41_22_1_15` 입니다.
- 단축 주소는 막지 않지만 신고될 수 있으니 원래 주소를 권하세요. 자버 공유 링크는 공유 페이지(`SELECT_SHARE`)로 바꿔 붙입니다.
- 받는 사람 모두 같은 링크입니다. 결과의 열람은 버튼을 누른 수이고 응답은 `null` 입니다. 광고·쿠폰 안내면 경고 `LINK_LANDING_NOTICE`(링크 첫 화면에 혜택 안내가 먼저 보이게)가 붙습니다.

## 발송 안전장치

실제 비용이 드는 발송은 웹과 같은 규칙으로 서버가 검사합니다. 이 패키지는 요청을 전달만 하므로 우회할 수 없습니다.

- **2단계 발송**: `prepare_send` 가 대상 수·예상 비용·렌더된 미리보기와 `operationUuid`·`confirmHash` 를 돌려줍니다. `submit_send` 는 이 값과 새 `idempotencyKey` 로 호출하며, 준비 이후 대상·본문·서식·비용이 바뀌었으면 거부되어 다시 준비해야 합니다. 별도의 사람 승인 단계는 없고, 발송 가능 여부는 아래 서버 정책으로 판단합니다(자동화 워크플로에서도 그대로 동작).
- **멱등 키**: `submit_send` 는 `idempotencyKey` 가 필수이며, 같은 키로 다시 호출해도 한 번만 발송됩니다. 이 패키지는 실패한 호출을 자동 재시도하지 않습니다.
- **접수 확인 대기**: `submit_send` 가 409 `J_41_23_4_5`(`pending`)를 돌려주거나 `get_campaign` 에 `pendingOperation`(`SUBMITTING`)이 있으면, 같은 `operationUuid`·`confirmHash`·`idempotencyKey` 로 다시 호출해 결과를 받으세요. 키를 잃었으면 새 키로 보내지 말고 `get_campaign` 으로 상태만 다시 확인합니다(5분 안에 접수가 끝나지 않으면 서버가 `READY` 로 정리). `J_41_23_4_5` 의 `lastErrorCode` 는 마지막 오류 코드(거절 확정 아님)이고, 거절이 확정된 경우만 `sourceErrorCode` 로 옵니다.
- **풀리지 않는 거절**: 구독·선불 잔액·연동비·발송 한도 같은 웹 발송 검증 거절은 `J_41_23_1_9`(`data.sourceErrorCode` = 원래 코드, `data.sourceMessage` = 원문 메시지)이며 `needsPrepare` 가 없습니다. 다시 준비해도 같은 결과이므로 원인을 해결한 뒤 진행하세요. `prepare_send` 도 이 검증을 미리 하므로 대부분 준비 단계에서 걸립니다.
- **다시 준비 여부**: 실패 응답에 `data.needsPrepare` 가 있으면 `prepare_send` 부터 다시 하세요. 준비 만료(`J_41_23_4_1`), 확인값·상태 변경(`J_41_23_4_2`), 받는 사람 값 변경(`J_41_23_2_1`), 실패한 멱등 키 재시도(`J_41_23_2_2`) 등에 붙습니다. 아래 조건 거절(`J_41_23_1_9`)과 템플릿 변경(`J_41_23_4_11`, 원문 다시 변환 필요)에는 붙지 않습니다. `J_41_23_4_2` 에 `data.status`(발송 중·예약·완료·취소)가 있거나 같은 키 재시도 응답에 `data.stopped` 가 있으면 다시 준비하지 말고 `get_campaign` 으로 상태를 확인하세요.
- **결과 조회 상태**: `get_campaign_results` 응답의 `campaignStatus`·`canceledReason`(`SEND_STOPPED` = 발송 중단·스팸 검토 거부, `SCHEDULE_CANCELED` = 예약 취소)은 `get_campaign` 과 같은 규칙으로 계산한 캠페인 상태이고, `statsAvailable: false` 면 집계할 발송 결과가 없습니다.
- **멈춘 제출**: `submit_send` 가 409 `J_41_23_4_9`(`data.superseded = true`, `notSent: true`)를 돌려주면 접수 확인이 늦어져 이 요청은 발송 작업을 만들지 않고 멈춘 것입니다. `data.reason` 은 `NEWER_SUBMISSION`(새 제출이 먼저 접수) 또는 `STALE_SUBMISSION`(새 제출 없이 멈춤)입니다. 바로 다시 준비하지 말고 `get_campaign` 으로 상태를 확인하고, 캠페인이 `READY`·`PREPARED` 면 사용자 확인 뒤 `prepare_send` 부터 다시 할 수 있습니다.
- **확정값 발송**: 예약 발송을 포함해 실제 발송은 `submit_send` 때 확정한 받는 사람(번호·이름)과 개인화 값으로 나갑니다. 그 뒤 연락처를 바꿔도 이미 확정한 발송 내용은 바뀌지 않습니다.
- **링크 없이 보내기**: `select_survey` 의 `NONE` 은 같은 템플릿의 버튼 없는 변형으로 바꿔 보냅니다. 버튼 없는 변형이 없는 템플릿(`get_campaign` 의 `noLinkAvailable: false`)은 `NONE` 이 400 `J_41_22_1_11` 이니 연결할 링크를 골라 주세요.
- **개인화 변수 연결(재확정)**: `commit_recipients` 의 변수 연결은 매번 그 요청의 `customColumnMap` 기준으로 다시 정해집니다. 명단을 다시 확정할 때 기존 연결을 유지하려면 같은 칸에 `variable` 을 다시 지정하세요. `variable` 을 빼거나 그 칸을 빼면 연결이 풀리고(`unboundVariables`) 값을 다시 묻습니다.
- **수신자 제한**: 발송 대상은 `commit_recipients` 로 서버에 등록된 캠페인 대상뿐이며, 전화번호를 발송 요청에 직접 넣을 수 없습니다.
- **야간 자동 예약**: 광고·쿠폰 메시지는 21:00~08:00(KST)에 보낼 수 없습니다. 이 시간에 `prepare_send` 를 부르면 묻지 않고 다음 08:00 으로 예약하고(예약 시각이 이 시간 안이면 그 뒤 첫 08:00) `summary.adjustments`(`QUIET_HOURS_RESCHEDULED`)로 알려 줍니다. 그대로 `submit_send` 하면 예약됩니다. 옮긴 날이 사용기한보다 뒤면 400 `J_41_23_1_11`, 같은 날이면 경고 `EXPIRY_SAME_DAY`. 지금 보내기로 준비했는데 `submit_send` 시점이 야간이면 400 `J_41_23_1_2`(`data.needsPrepare: true`)이니 `prepare_send` 를 다시 부르면 08:00 자동 예약이 됩니다.
- **채널 미연동 한도**: 채널 연동은 필수가 아닙니다. 미연동이면 체험 10건(삭제 포함)과 외부 링크·광고 쿠폰 3명 상한(409 `J_41_23_1_13`)을 `prepare_send`·`submit_send` 때 두 번 확인합니다. 다시 준비해도 풀리지 않으니 받는 사람을 줄이거나 채널을 연동하세요([채널 미연동 발송 한도](#채널-미연동-발송-한도)).
- **연쇄 변경 중단**: `draft_send`·`answer_questions` 도중 다른 요청이 캠페인을 바꾸면 성공 응답 안에서 남은 단계만 멈추고 `skipped`·`failedSteps` 에 `J_41_21_4_2` + `data.stoppedBy` 가 남습니다. `get_campaign` 으로 최신 상태를 보고 다시 답하세요.
- **수신거부 링크 기본 켬**: 정보성 안내까지 기본으로 붙습니다. 정보성만 `update_campaign` 의 `optOutLink: false` 로 끌 수 있습니다. 붙일 수 없는 템플릿이면 경고 `OPT_OUT_UNAVAILABLE`.
- **서버 정책 동일 적용**: 스팸·금지 업종 차단, 광고성 메시지의 수신 동의 확인(`SEND_BASIS`), 1000자 제한, 잔액·발송 한도 검사.
- **사후 확인**: 발송되면 스페이스 관리자에게 바로 알림이 가고, 예약 발송은 `cancel_scheduled_send` 나 웹에서 취소할 수 있습니다.
- **키 관리**: 개인 API 키는 발급한 관리자 개인에게 귀속되고 서버에는 해시로만 저장됩니다. 의심되면 [설정 > AI 도구 연동](https://jober.io/settings/integrations)에서 즉시 폐기하세요. 이 패키지는 키를 환경 변수로만 받고 https 로만 보냅니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `JOBER_API_KEY 환경 변수가 없습니다` | 클라이언트 설정의 `env` 에 키를 넣었는지 확인 |
| `인증에 실패했습니다(HTTP 401)` | 키 오타·폐기 여부 확인, 필요하면 새 키 발급. 회사 API 키(`jbr_co_`)를 넣었다면 개인 API 키(`jbr_live_`)로 바꾸기 |
| `권한이 없습니다(HTTP 403)` | 키 권한(scope)과 스페이스의 MCP 사용 설정 확인. 계정·IP 차단이면 `J_41_25_3_4`, 연락처 보기·수정 권한이 없으면 `J_41_22_3_1` |
| `요청이 너무 많습니다(HTTP 429)` | 잠시 후 다시 시도. 설문 생성 하루 한도면 `J_41_22_4_17`(KST 자정 초기화, 그 전에는 `list_surveys` 로 기존 설문 사용), 호출 한도면 `J_41_20_4_2` |
| `J_41_23_4_5`(409, `pending`) | 접수 결과를 확인하는 중입니다. 같은 `idempotencyKey` 로 잠시 후 다시 호출하면 결과를 돌려받습니다 |
| `J_41_23_1_13`(409) | 채널 미연동 외부 링크·광고 쿠폰 3명 상한 초과(`data.remaining`). 받는 사람을 줄여 `commit_recipients` 부터 다시 하거나 `data.connectUrl` 에서 채널 연동 |
| `J_41_23_4_4`(409, `NO_BUTTON_TEMPLATE`) | 목적지가 있는데 링크 버튼 템플릿이 없음. 링크 없이 보내려면 `select_survey` 의 `NONE` 후 다시 준비 |
| `J_41_23_1_10`(400) | 비상시에 채널 연동을 다시 필수로 켰을 때만. `data.connectUrl` 에서 연동한 뒤 `prepare_send` 부터 다시 |
| `J_41_23_1_2`(400, `needsPrepare`) | 지금 보내기로 준비했는데 실행 시점이 야간. `prepare_send` 다시(08:00 자동 예약) |
| `J_41_23_1_1`(400) | 문구 검사 실패. `data.errors[].code` 가 `PROMOTIONAL_COPY` 면 홍보 표현(연락처 칸 값이면 `count`·`examples`), `BUTTON_TARGET_FIXED` 면 고정 주소 버튼 템플릿 |
| `J_41_23_1_11`(400) | 보내는 날이 사용기한보다 뒤. `update_campaign` 으로 사용기한을 고치기 |
| `J_41_22_1_12`~`J_41_22_1_15`(400) | 내 링크를 붙일 수 없음(주소 형식·고정 주소 템플릿·스팸 판정·검사 내용 초과). 다른 링크를 넣거나 안내 페이지 생성(`GENERATE_INFO`) |
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
(`https://api.jober.io/mcp`, Streamable HTTP) using your personal API key (`jbr_live_`) as `Authorization: Bearer <JOBER_API_KEY>`.
Company API keys (`jbr_co_`) are for server integrations (send API, free-send REST) and are rejected by MCP (HTTP 401).

- **API key**: create one at https://jober.io/settings/integrations (shown once; revoke it there at any time).
- **Install**: `claude mcp add jober -e JOBER_API_KEY=jbr_live_xxxxxxxx -- npx -y @joberhr/jober-mcp`, or use the
  `npx -y @joberhr/jober-mcp` command with the `JOBER_API_KEY` env var in Claude Desktop, Cursor or VS Code (snippets above).
- **Remote (OAuth)**: clients that support remote MCP can connect to `https://api.jober.io/mcp` directly and sign in with OAuth 2.1 (PKCE).
- **Env vars**: `JOBER_API_KEY` (required), `JOBER_API_BASE` (default `https://api.jober.io`, https only except localhost).
- **Tools**: the 20 tools listed above, including `get_send_readiness`, `draft_send` (convert + attach your link + start a landing page + check recipients in one call), `answer_questions` and `set_direct_link` (your own URL on the AlimTalk button, "message+link").
- **Guide**: results carry `guide` (`stage`, `questions` to ask the user, `nextActions` with prefilled args). Follow it and answer all questions with `answer_questions`.
- **Kakao channel**: connecting a Kakao channel is recommended but not required. Without one, sends go out through Jober's shared
  channel under the same limits as the web app (see `limits` in `get_send_readiness`), and external-link or ad-coupon sends are
  capped at 3 recipients per space (`J_41_23_1_13`). A destination without a link-button template is rejected with `J_41_23_4_4`
  (`NO_BUTTON_TEMPLATE`).
- **Campaign status**: `status` is computed on every read (10 values: DRAFT, NEEDS_INPUT, READY, PREPARED, BLOCKED, SCHEDULED,
  SENDING, SENT, CANCELED, FAILED). `pendingOperation.status` is only `SUBMITTING`; `UNKNOWN` is no longer returned.
- **Send safety**: two-step `prepare_send` then `submit_send` with a confirm hash and a required idempotency key (no separate human approval step), recipients
  limited to those committed on the server, the same server-side policies as the web app (spam blocking, opt-out text,
  ad consent, ad sends prepared between 21:00 and 08:00 KST are rescheduled to the next 08:00 without asking and reported in
  `summary.adjustments`, the opt-out link on by default (only informational campaigns may turn it off), 1000-character limit, balance and send limits), instant admin
  notification and cancellable scheduled sends. The proxy never retries failed calls automatically.

## License

MIT
