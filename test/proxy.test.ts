import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkApiKey, ConfigError, KEY_ISSUE_URL, loadConfig, loadStartupConfig, resolveEndpoint } from '../src/config.js';
import { createGuideServer } from '../src/guideMode.js';
import { createProxyServer, type ProxyServer } from '../src/proxy.js';
import { CONTRACT_TOOLS, startMockRemote, VALID_KEY, type MockRemote } from './mockRemote.js';

const VERSION = '0.0.0-test';
// 가입 링크(MCP 유입 표식, client=local). 오픈 리다이렉트가 없는 고정 경로.
const SIGNUP_URL = 'https://jober.io/start/ai?src=mcp&client=local';
const ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

async function connectLocal(apiBase: string, apiKey = VALID_KEY): Promise<{ client: Client; proxy: ProxyServer }> {
  const proxy = createProxyServer(loadConfig({ JOBER_API_BASE: apiBase, JOBER_API_KEY: apiKey }), VERSION);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await proxy.server.connect(serverTransport);
  const client = new Client({ name: 'local-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, proxy };
}

function firstText(result: Record<string, unknown>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? '';
}

describe('resolveEndpoint / loadConfig', () => {
  it('기본값은 https://api.jober.io/mcp', () => {
    expect(resolveEndpoint(undefined).toString()).toBe('https://api.jober.io/mcp');
    expect(resolveEndpoint('  ').toString()).toBe('https://api.jober.io/mcp');
  });

  it('베이스 주소에 /mcp 를 붙이고, 이미 /mcp 면 그대로 둔다', () => {
    expect(resolveEndpoint('https://dev-api.jober.io/').toString()).toBe('https://dev-api.jober.io/mcp');
    expect(resolveEndpoint('https://api.jober.io/mcp/').toString()).toBe('https://api.jober.io/mcp');
    expect(resolveEndpoint('http://localhost:4100').toString()).toBe('http://localhost:4100/mcp');
  });

  it('localhost 가 아닌 http 주소와 잘못된 URL 은 거부한다', () => {
    expect(() => resolveEndpoint('http://api.jober.io')).toThrow(ConfigError);
    expect(() => resolveEndpoint('not a url')).toThrow(ConfigError);
  });

  it('JOBER_API_KEY 가 없으면 키 발급 위치를 안내한다', () => {
    expect(() => loadConfig({})).toThrow(KEY_ISSUE_URL);
  });
});

describe('원격 jober MCP 프록시', () => {
  let remote: MockRemote;
  let opened: Array<{ client: Client; proxy: ProxyServer }> = [];

  const open = async (apiBase: string, apiKey?: string) => {
    const pair = await connectLocal(apiBase, apiKey);
    opened.push(pair);
    return pair.client;
  };

  beforeEach(async () => {
    remote = await startMockRemote();
  });

  afterEach(async () => {
    for (const { client, proxy } of opened) {
      await client.close();
      await proxy.closeRemote();
    }
    opened = [];
    await remote.close();
  });

  it('tools/list 를 페이지 커서까지 그대로 넘기고 Bearer 키·User-Agent 를 보낸다', async () => {
    const client = await open(remote.url);
    const page1 = await client.listTools();
    expect(page1.nextCursor).toBe('page2');
    const page2 = await client.listTools({ cursor: page1.nextCursor });
    const names = [...page1.tools, ...page2.tools].map((tool) => tool.name);
    expect(names).toEqual(CONTRACT_TOOLS);
    expect(page1.tools[0]?.inputSchema).toEqual({ type: 'object', properties: { campaignUuid: { type: 'string' } } });

    expect(remote.requests.length).toBeGreaterThan(0);
    for (const request of remote.requests) {
      expect(request.authorization).toBe(`Bearer ${VALID_KEY}`);
      expect(request.userAgent).toBe(`jober-mcp/${VERSION}`);
    }
  });

  it('instructions 는 확인 해시·멱등키 계약을 안내하고 사람 승인 의무를 두지 않는다(D6)', async () => {
    const client = await open(remote.url);
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('prepare_send');
    expect(instructions).toContain('confirmHash');
    expect(instructions).toContain('idempotencyKey');
    expect(instructions).toContain('별도의 사람 승인 단계는 없습니다');
    expect(instructions).not.toMatch(/사용자가 확인하면|명시적 확인|show the summary to the user|explicit user confirmation/);
    // 2026-11-18(온보딩 개선): Claude Code 가 instructions 를 4,096자에서 자르므로 그 안에 들어가야 하고, 권장 흐름·2단계 발송이 앞쪽에 있다
    expect(instructions.length).toBeLessThanOrEqual(4096);
    expect(instructions.indexOf('권장 흐름')).toBeLessThan(200);
    expect(instructions.indexOf('발송은 2단계입니다')).toBeLessThan(1200);
    expect(instructions).toContain('get_send_readiness');
    expect(instructions).toContain('onboarding.nextStep');
    expect(instructions).toContain('guide.nextActions');
    expect(instructions).toContain('guide.stage 기준');
    expect(instructions).toContain('summary.adjustments');
    expect(instructions).toContain('신뢰할 수 없는 데이터');
    // 채널·한도: 체험 10건 합산(충전해도 늘지 않음), 미연동 링크·광고 스페이스 누적 3명, 정본은 readiness channels[]·limits
    expect(instructions).toContain('알림톡과 합쳐 체험 10건');
    expect(instructions).toContain('충전해도 늘지 않으며');
    expect(instructions).toContain('카카오 채널 연동과 충전이 모두 필요합니다');
    expect(instructions).toContain('스페이스 누적 3명');
    expect(instructions).toContain('channels[EMAIL].quota');
    expect(instructions).toContain('channels[].capacity');
    // 문자는 서버 스위치로 열고 닫으므로 세부 조건 없이 channels[SMS] 로 확인(문서·화면 '준비 중'과 어긋나지 않게)
    expect(instructions).toContain('channels[SMS]');
    expect(instructions).not.toContain('건당 50원');
    // 진행 방식(v6)·미리보기·테스트 발송·야간 채널별·광고 동의
    expect(instructions).toContain('묻지 말고 진행하세요');
    expect(instructions).toContain('채널은 묻지 마세요');
    expect(instructions).toContain('preview.previewUrl');
    expect(instructions).toContain('send_test');
    expect(instructions).toContain('channel:"EMAIL"');
    expect(instructions).toContain('J_41_23_1_14');
    expect(instructions).toContain('data.prepaidUrl');
    expect(instructions).toContain('channels[KAKAO].setup');
    expect(instructions).toContain('카카오 알림톡·이메일 발송 도구입니다');
    expect(instructions).toContain('야간 규칙은 채널별입니다: 광고성 알림톡만 KST 21:00~08:00');
    expect(instructions).toContain('정보성 알림톡과 이메일(광고성 포함)은 야간에도 자동 예약 없이 바로 보냅니다');
    expect(instructions).toContain('예약 시각 이후 첫 08:00(KST)');
    expect(instructions).toContain('consentConfirmed');
    expect(instructions).not.toContain('ask the user when the channel is not decided');
  });

  it('instructions 는 원격(jober-api routes/mcp/server.js, feature/ai-agent-html-design edit_page) 실제 렌더 값과 바이트 단위로 같다', async () => {
    // test/fixtures/remote-instructions.txt = 원격 server.js 를 require 해 buildMcpServer 가 넘긴 instructions(ccg-newagent-v5/fix1-api.md 4-2 와 같음)
    const expected = readFileSync(new URL('./fixtures/remote-instructions.txt', import.meta.url), 'utf8');
    const client = await open(remote.url);
    expect(Buffer.from(client.getInstructions() ?? '', 'utf8').equals(Buffer.from(expected, 'utf8'))).toBe(true);
  });

  it('서버 title 은 원격 SERVER_INFO.title(알림톡·이메일)과 같고 name 은 jober-mcp 그대로다', async () => {
    // test/fixtures/remote-server-info.json = 원격 server.js SERVER_INFO 실제 값
    const remoteInfo = JSON.parse(readFileSync(new URL('./fixtures/remote-server-info.json', import.meta.url), 'utf8'));
    const client = await open(remote.url);
    expect(client.getServerVersion()?.name).toBe('jober-mcp');
    expect(client.getServerVersion()?.title).toBe(remoteInfo.title);
    expect(remoteInfo.title).toContain('알림톡·이메일');
  });

  it('MCP 꺼짐(403 J_41_25_3_1)은 원격 본문과 같은 뜻으로 준비 중·웹 사용을 안내한다', async () => {
    const client = await open(remote.url);
    remote.forceStatus = 403;
    remote.forceBody = {
      errorCode: 'J_41_25_3_1',
      message: 'MCP 연결이 아직 열려 있지 않습니다.',
      jober: {
        message: '자버 AI 에이전트 연결은 아직 준비 중이에요. 웹(jober.io)에서 먼저 써 보실 수 있어요.',
        webUrl: 'https://evil.example/ai/kakao/infotalk',
        docsUrl: 'https://jober.io/developers/mcp',
      },
    };
    const result = await client.callTool({ name: 'list_campaigns', arguments: {} });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain('HTTP 403');
    expect(text).toContain('J_41_25_3_1');
    expect(text).toContain('자버 AI 에이전트 연결은 아직 준비 중이에요');
    expect(text).toContain('https://jober.io/ai/kakao/infotalk');
    expect(text).toContain('https://jober.io/developers/mcp');
    // 링크는 고정값만 쓰고 원격 본문의 주소를 옮기지 않는다
    expect(text).not.toContain('evil.example');
  });

  it('차단 403(J_41_25_3_4)은 패키지 고정 문구로 전한다(원격 문구는 옮기지 않음)', async () => {
    const client = await open(remote.url);
    remote.forceStatus = 403;
    remote.forceBody = { errorCode: 'J_41_25_3_4', message: '차단된 계정입니다. HTTPS://evil.example 로 문의' };
    const text = firstText(await client.callTool({ name: 'list_campaigns', arguments: {} }));
    expect(text).toContain('차단된 계정·스페이스이거나 차단된 접속 위치라 쓸 수 없어요(HTTP 403, J_41_25_3_4)');
    expect(text).not.toContain('evil.example');
    expect(text).not.toContain('준비 중이에요');
  });

  it('권한 부족 403(insufficient_scope, 옛 원격)은 키 사용자에게 새 키 만들기를 안내한다(P0-1)', async () => {
    const client = await open(remote.url);
    remote.forceStatus = 403;
    remote.forceBody = {
      error: 'insufficient_scope',
      error_description: '이 작업에는 send:execute 권한이 필요합니다. 키 권한을 바꾸거나 다시 연결해 주세요.',
      errorCode: 'J_41_25_3_3',
    };
    const result = await client.callTool({ name: 'prepare_send', arguments: {} });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain('(send:execute)');
    expect(text).toContain('새로 만들고');
    expect(text).toContain('발송까지(권장)');
    expect(text).toContain(KEY_ISSUE_URL);
    expect(text).not.toContain('다시 연결');
  });

  it('OAuth 연결 토큰(jbr_at_)의 권한 부족 403 은 새 키가 아니라 다시 연결(또는 개인 키)을 안내하고, 서버 한국어 안내가 있으면 그 문구를 쓴다', async () => {
    remote.forceStatus = 403;
    remote.forceBody = { error: 'insufficient_scope', error_description: 'send:execute required' };
    const proxy = createProxyServer(loadConfig({ JOBER_API_BASE: remote.url, JOBER_API_KEY: `jbr_at_${'T'.repeat(43)}` }), VERSION);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await proxy.server.connect(serverTransport);
    const client = new Client({ name: 'local-test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    opened.push({ client, proxy });
    const text = firstText(await client.callTool({ name: 'prepare_send', arguments: {} }));
    expect(text).toContain('OAuth 연결 토큰에는');
    expect(text).toContain('(send:execute)');
    expect(text).toContain('다시 연결');
    remote.forceBody = { error: 'insufficient_scope', error_description: 'send:execute', jober: { message: 'HTTPS://evil.example 에서 다시 연결' } };
    const second = firstText(await client.callTool({ name: 'prepare_send', arguments: {} }));
    expect(second).toContain('OAuth 연결 토큰에는');
    expect(second).not.toContain('evil.example');
  });

  it('확장 프로그램(.mcpb)으로 실행하면 키 거절 안내에 확장 프로그램 설정 위치를 덧붙이고, 비운 키 칸(치환 안 된 값)은 키 없음으로 본다', async () => {
    expect(checkApiKey('${user_config.jober_api_key}')).toEqual({ ok: false, problem: 'MISSING' });
    const wrongKey = `jbr_live_${'M'.repeat(32)}`;
    const proxy = createProxyServer(loadConfig({ JOBER_API_BASE: remote.url, JOBER_API_KEY: wrongKey }), VERSION, { mcpb: true, guide: { timeoutMs: 500 } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await proxy.server.connect(serverTransport);
    const client = new Client({ name: 'local-test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    opened.push({ client, proxy });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['get_started']);
    const text = firstText(await client.callTool({ name: 'get_started', arguments: {} }));
    expect(text).toContain('확장 프로그램 > 자버 > 설정');
  });

  it('원격 문구에 자버 밖 주소가 있으면 쓰지 않고 패키지 문구로(401·403), 403 차단 문구는 길이를 자른다', async () => {
    remote.forceStatus = 401;
    remote.forceBody = { error: 'invalid_token', jober: { reason: 'API_KEY_INVALID', message: '키를 HTTPS://evil.example/login 에서 다시 받으세요' } };
    const client = await open(remote.url);
    await client.listTools();
    const text = firstText(await client.callTool({ name: 'get_started', arguments: {} }));
    expect(text).not.toContain('evil.example');
    expect(text).toContain('맞지 않거나 폐기된 키');

    const second = await open(remote.url);
    remote.forceStatus = 403;
    remote.forceBody = { errorCode: 'J_41_25_3_4', message: `차단 ${'가'.repeat(600)}` };
    expect(firstText(await second.callTool({ name: 'list_campaigns', arguments: {} })).length).toBeLessThan(400);
    remote.forceBody = { errorCode: 'J_41_25_3_4', message: '여기로 https://evil.example 문의' };
    expect(firstText(await second.callTool({ name: 'list_campaigns', arguments: {} }))).not.toContain('evil.example');
  });

  it('OAuth 토큰이어도 관리자 권한 상실(NOT_MANAGER) 401 은 만료가 아니라 거절(REJECTED)로 보여 준다', async () => {
    remote.forceStatus = 401;
    remote.forceBody = { error: 'invalid_token', jober: { reason: 'NOT_MANAGER', message: '이 키(연결)를 만든 분이 지금은 이 스페이스의 관리자가 아니에요.' } };
    const client = await open(remote.url, `jbr_at_${'N'.repeat(43)}`);
    await client.listTools();
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    expect((result.structuredContent as { keyStatus: string }).keyStatus).toBe('REJECTED');
    expect(firstText(result)).toContain('관리자가 아니에요');
    expect(firstText(result)).not.toContain('만료돼');
  });

  it('확장 프로그램(.mcpb)으로 키 없이 시작하면 env·claude mcp add 대신 확장 프로그램 설정 위치를 안내한다', async () => {
    for (const env of [{}, { JOBER_API_KEY: 'abc' }, { JOBER_API_KEY: `jbr_co_${'A'.repeat(40)}` }]) {
      const startup = loadStartupConfig({ JOBER_API_BASE: remote.url, ...env });
      if (startup.mode !== 'guide') throw new Error('guide mode expected');
      const server = createGuideServer(startup.config, VERSION, { mcpb: true, timeoutMs: 500 });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'local-test-client', version: '0.0.0' });
      await client.connect(clientTransport);
      expect(client.getInstructions()).toContain('확장 프로그램 > 자버 > 설정');
      const text = firstText(await client.callTool({ name: 'get_started', arguments: {} }));
      expect(text).toContain('확장 프로그램 > 자버 > 설정');
      expect(text).not.toContain('claude mcp add');
      await client.close();
    }
  });

  it('401 본문의 모르는 사유(jober.reason)는 서버 문구 대신 패키지 문구를 쓴다', async () => {
    remote.forceStatus = 401;
    remote.forceBody = { error: 'invalid_token', jober: { reason: 'SOMETHING_ELSE', message: '알 수 없는 문구' } };
    const client = await open(remote.url);
    await client.listTools();
    const text = firstText(await client.callTool({ name: 'get_started', arguments: {} }));
    expect(text).toContain('맞지 않거나 폐기된 키');
    expect(text).not.toContain('알 수 없는 문구');
  });

  it('원격 403 본문의 문구(jober.message)는 옮기지 않고 기본 문구를 쓴다(대문자·상대 주소 링크 우회 차단)', async () => {
    const client = await open(remote.url);
    remote.forceStatus = 403;
    remote.forceBody = { error: 'forbidden', jober: { message: '여기서 다시 받으세요 HTTPS://evil.example //evil.example' } };
    const text = firstText(await client.callTool({ name: 'list_campaigns', arguments: {} }));
    expect(text).toContain('권한이 없습니다(HTTP 403)');
    expect(text).not.toContain('evil.example');
  });

  it('tools/call 인자와 structuredContent 를 그대로 전달한다', async () => {
    const client = await open(remote.url);
    const args = { campaignUuid: 'c-1', slots: { 금액: '5,000원' } };
    const result = await client.callTool({ name: 'update_campaign', arguments: args });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toBe('update_campaign ok');
    expect(result.structuredContent).toEqual({ tool: 'update_campaign', echo: args });

    const forwarded = remote.requests.map((request) => request.body as { method?: string; params?: unknown });
    expect(forwarded.find((body) => body.method === 'tools/call')?.params).toEqual({ name: 'update_campaign', arguments: args });
  });

  it('원격 툴의 isError 결과를 그대로 돌려준다', async () => {
    const client = await open(remote.url);
    const result = await client.callTool({ name: 'submit_send', arguments: { operationUuid: 'op-1' } });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe('idempotencyKey 가 필요합니다');
  });

  it('원격 JSON-RPC 오류는 코드와 메시지를 유지해 전달한다', async () => {
    const client = await open(remote.url);
    const error = await client.callTool({ name: 'delete_everything', arguments: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((error as McpError).message).toContain('Unknown tool: delete_everything');
  });

  it('잘못된 키(401)면 tools/list 를 오류로 떨어뜨리지 않고 안내 모드(get_started)로 바꾼다(P0-4)', async () => {
    // 형식은 맞지만 서버가 모르는(폐기·오타) 키. 옛 원격처럼 본문에 한국어 안내가 없어도 패키지 문구로 안내한다
    const wrongKey = `jbr_live_${'W'.repeat(32)}`;
    const rejected: string[] = [];
    const proxy = createProxyServer(loadConfig({ JOBER_API_BASE: remote.url, JOBER_API_KEY: wrongKey }), VERSION, {
      onRejected: (detail) => rejected.push(detail),
      guide: { timeoutMs: 500 },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await proxy.server.connect(serverTransport);
    const client = new Client({ name: 'local-test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    opened.push({ client, proxy });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['get_started']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('맞지 않거나 폐기된 키');
    expect(rejected[0]).not.toContain(wrongKey);

    const guide = await client.callTool({ name: 'get_started', arguments: {} });
    expect(guide.isError).toBeFalsy();
    const guideText = firstText(guide);
    expect(guideText).toContain('자버 서버가 JOBER_API_KEY 를 거절해(HTTP 401)');
    expect(guideText).toContain('맞지 않거나 폐기된 키');
    expect(guideText).toContain(KEY_ISSUE_URL);
    expect(guideText).toContain(SIGNUP_URL);
    expect(guideText).not.toContain(wrongKey);
    expect((guide.structuredContent as { keyStatus: string }).keyStatus).toBe('REJECTED');

    const other = await client.callTool({ name: 'list_campaigns', arguments: {} });
    expect(other.isError).toBe(true);
    expect(firstText(other)).toContain('안내 전용 모드');
    // 거절 뒤에는 원격에 다시 붙지 않는다(키를 바꾸려면 다시 시작해야 한다)
    const mcpCalls = remote.requests.length;
    await client.listTools();
    expect(remote.requests.length).toBe(mcpCalls);
  });

  it('401 본문의 한국어 안내(jober.message)가 있으면 그 사유를 쓴다(관리자 권한 상실 등)', async () => {
    remote.forceStatus = 401;
    remote.forceBody = {
      error: 'invalid_token',
      error_description: 'The connected person is no longer a manager of this space',
      jober: { reason: 'NOT_MANAGER', message: '이 키(연결)를 만든 분이 지금은 이 스페이스의 관리자가 아니에요.' },
    };
    const client = await open(remote.url);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['get_started']);
    const text = firstText(await client.callTool({ name: 'get_started', arguments: {} }));
    expect(text).toContain('이 스페이스의 관리자가 아니에요');
    expect(text).not.toContain('The connected person');
  });

  it('OAuth 연결 토큰(jbr_at_)이 거절되면 1시간 만료·개인 키·원격 OAuth 연결을 안내한다(P2-5)', async () => {
    const token = `jbr_at_${'T'.repeat(43)}`;
    const client = await open(remote.url, token);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['get_started']);
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    const text = firstText(result);
    expect(text).toContain('1시간 뒤 만료');
    expect(text).toContain('jbr_live_');
    expect(text).toContain('https://api.jober.io/mcp');
    expect(text).not.toContain(token);
    expect((result.structuredContent as { keyStatus: string }).keyStatus).toBe('TOKEN_EXPIRED');
  });

  it('쓰는 도중 키가 거절되면(401) 그 호출은 한국어 사유로 끝나고 툴 목록 변경을 알린 뒤 안내 모드가 된다', async () => {
    const client = await open(remote.url);
    let changed = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      changed += 1;
    });
    expect((await client.listTools()).tools.length).toBeGreaterThan(1);
    remote.forceStatus = 401;
    remote.forceBody = { error: 'invalid_token', jober: { reason: 'API_KEY_INVALID', message: '자버 개인 API 키가 맞지 않거나 폐기된 키예요.' } };
    const result = await client.callTool({ name: 'list_campaigns', arguments: {} });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('자버 개인 API 키가 맞지 않거나 폐기된 키예요(HTTP 401)');
    expect(firstText(result)).toContain('안내 전용 모드');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(changed).toBe(1);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['get_started']);
  });

  it('원격 서버가 꺼져 있으면 연결 불가 오류를 준다', async () => {
    const downUrl = remote.url;
    await remote.close();
    const client = await open(downUrl);

    const result = await client.callTool({ name: 'list_campaigns', arguments: {} });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('연결할 수 없습니다');
    expect(firstText(result)).toContain(`${downUrl}/mcp`);

    const listError = await client.listTools().catch((e: unknown) => e);
    expect((listError as McpError).message).toContain('연결할 수 없습니다');
    remote = await startMockRemote();
  });

  it('일시 장애(503) 뒤에는 다시 연결해 정상 처리한다(자동 재시도는 하지 않음)', async () => {
    const client = await open(remote.url);
    expect((await client.callTool({ name: 'get_job', arguments: {} })).isError).toBeFalsy();

    remote.forceStatus = 503;
    const failed = await client.callTool({ name: 'get_job', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(firstText(failed)).toContain('HTTP 503');
    const failedCalls = remote.requests.filter((r) => (r.body as { method?: string }).method === 'tools/call').length;

    remote.forceStatus = undefined;
    const recovered = await client.callTool({ name: 'get_job', arguments: { jobUuid: 'j-1' } });
    expect(recovered.isError).toBeFalsy();
    expect(recovered.structuredContent).toEqual({ tool: 'get_job', echo: { jobUuid: 'j-1' } });
    // 실패한 호출은 한 번만 전송되었다(재시도 없음): 성공 1 + 실패 1 = 2
    expect(failedCalls).toBe(2);
  });
});

describe('bin 엔트리(stdio)', () => {
  let remote: MockRemote;

  beforeEach(async () => {
    remote = await startMockRemote();
  });

  afterEach(async () => {
    await remote.close();
  });

  it('npx 로 실행되는 stdio 서버가 원격으로 프록시한다', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      env: { ...getDefaultEnvironment(), JOBER_API_BASE: remote.url, JOBER_API_KEY: VALID_KEY },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test-client', version: '0.0.0' });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.name).toBe('jober-mcp');
      expect(client.getInstructions()).toContain('prepare_send');
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(CONTRACT_TOOLS.slice(0, 10));
      const result = await client.callTool({ name: 'convert_message', arguments: { sourceText: '안녕하세요' } });
      expect(result.structuredContent).toEqual({ tool: 'convert_message', echo: { sourceText: '안녕하세요' } });
    } finally {
      await client.close();
    }
  });

  it('JOBER_API_KEY 가 없으면 종료하지 않고 안내 전용 모드로 시작한다(stderr 안내, stdout 은 MCP 전용)', () => {
    // stdin 이 바로 닫히면 서버도 정상 종료(0)한다. 수정 전에는 키가 없어 1 로 끝났다.
    const run = spawnSync(process.execPath, [ENTRY], {
      env: { ...getDefaultEnvironment(), JOBER_API_BASE: remote.url },
      input: '',
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(run.status).not.toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('JOBER_API_KEY');
    expect(run.stderr).toContain(KEY_ISSUE_URL);
    expect(run.stderr).toContain('get_started');
  });
});

describe('배포 메타데이터', () => {
  it('server.json 이름·버전이 package.json(mcpName·version)과 일치한다', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].version).toBe(pkg.version);
    expect(server.remotes[0]).toEqual({ type: 'streamable-http', url: 'https://api.jober.io/mcp' });
  });

  it('Claude Desktop Extension(.mcpb) manifest: 내장 Node 로 dist/index.js 실행, 키 입력 칸(sensitive)을 JOBER_API_KEY 로, 고정 다운로드 주소(계약)', () => {
    const manifest = JSON.parse(readFileSync(new URL('../mcpb/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.manifest_version).toBe('0.3');
    expect(manifest.name).toBe('jober-mcp');
    expect(manifest.icon).toBe('icon.png');
    expect(manifest.server).toEqual({
      type: 'node',
      entry_point: 'dist/index.js',
      mcp_config: { command: 'node', args: ['${__dirname}/dist/index.js'], env: { JOBER_API_KEY: '${user_config.jober_api_key}', JOBER_MCP_DIST: 'mcpb' } },
    });
    // 키를 비워 두고 설치해도 켜진다(안내 모드)
    expect(manifest.user_config.jober_api_key).toMatchObject({ type: 'string', sensitive: true, required: false });
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('https://github.com/jober-lab/jober-mcp/releases/latest/download/jober-mcp.mcpb');
  });

  it('버전(0.7.0)·io.jober 이름공간·검색 키워드(알림톡)·가입 링크(client=registry)를 싣는다', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    expect(pkg.version).toBe('0.7.0');
    expect(server.name).toBe('io.jober/jober-mcp');
    // 0.6.1: description 은 검색 키워드 자리로 쓰고, 가입 링크는 JOBER_API_KEY 설명에만 둔다
    expect(server.description).toContain('KakaoTalk AlimTalk');
    expect(server.description).toContain('카카오 알림톡');
    expect(server.description).toMatch(/email/i);
    expect(server.packages[0].environmentVariables[0].description).toContain('https://jober.io/start/ai?src=mcp&client=registry');
    expect(pkg.keywords).toEqual(expect.arrayContaining(['alimtalk', 'kakaotalk', '알림톡', 'sms', 'korea', 'mcp']));
    // MCP Registry server.schema.json ServerDetail.description maxLength 100
    expect(server.description.length).toBeLessThanOrEqual(100);
    // 키가 없어도 안내 모드로 뜨므로 필수가 아니다
    expect(server.packages[0].environmentVariables[0]).toMatchObject({ name: 'JOBER_API_KEY', isRequired: false, isSecret: true });
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('https://jober.io/start/ai?src=mcp&client=local');
    expect(readme).toContain('처음이세요?');
    expect(readme).toContain('get_started');
    // fix1(A안): 이메일·알림톡 체험 10건 합산, 충전해도 연동 전에는 10건을 넘지 못함
    const firstTime = readme.slice(readme.indexOf('처음이세요?'), readme.indexOf('## English summary'));
    expect(firstTime).toContain('이메일과 알림톡을 합쳐 체험 10건');
    expect(firstTime).toContain('충전해도 늘지 않습니다');
    const emailRow = readme.split('\n').find((line) => line.startsWith('| 이메일 | `EMAIL`')) ?? '';
    expect(emailRow).toContain('알림톡과 합쳐 체험 10건');
    expect(emailRow).toContain('충전해도 늘지 않으며');
    // fix2: 채널별 야간 규칙(광고성 알림톡만 08:00 자동 예약, 이메일은 야간에도 즉시)과 서버 표시 이름
    expect(readme).toContain('광고성 알림톡만 밤 9시~아침 8시(한국 시간)에 보내지 않고');
    // fix4: 예약 시각 표현 통일, 이메일은 늘 EMAIL_NIGHT_ALLOWED
    expect(readme).toContain('예약 시각 이후 첫 08:00(한국 시간)으로 자동 예약해요');
    expect(readme).toContain('이메일 prepare_send 에는 늘 EMAIL_NIGHT_ALLOWED 안내가 붙어요');
    expect(readme).not.toContain('다음 08:00');
    // fix5: 3명 상한은 스페이스 누적
    const kakaoRow = readme.split('\n').find((line) => line.startsWith('| 카카오 알림톡 | `KAKAO`')) ?? '';
    expect(kakaoRow).toContain('스페이스 누적 3명까지(발송을 나눠도 합산)');
    expect(readme).not.toContain('받는 사람 3명까지');
    expect(readme).toContain('정보성 알림톡과 이메일(광고성 포함)은 야간에도 자동 예약 없이 바로 보내요');
    expect(readme).toContain('Jober (자버) 알림톡·이메일 AI 에이전트');
    // 0.6.1: 검색 노출용 제목·Jobber 구분·영어 요약을 앞쪽에 둔다
    expect(readme.split('\n')[0]).toContain('카카오 알림톡 MCP 서버 (KakaoTalk AlimTalk MCP)');
    expect(readme).toContain('It is not Jobber');
    expect(readme.indexOf('## English summary')).toBeGreaterThan(0);
    expect(readme.indexOf('## English summary')).toBeLessThan(readme.indexOf('## 할 수 있는 일'));
  });
});
