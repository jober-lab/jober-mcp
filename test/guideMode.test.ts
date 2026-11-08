import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkApiKey, ConfigError, loadConfig, loadStartupConfig, resolveGettingStartedUrl, SIGNUP_URL } from '../src/config.js';
import { createGuideServer, fetchGettingStarted, isFixedSignupUrl, isGettingStarted, loadFallbackGuide } from '../src/guideMode.js';
import { startMockRemote, VALID_KEY, type MockRemote } from './mockRemote.js';

// 안내 전용 모드(PLAN-v5 A-7): 키가 없거나 형식이 틀리면 종료하지 않고 get_started 툴 1개만 띄운다.
// 수정 전 코드에서는 키가 없으면 exit(1) 이라 bin 시나리오는 모두 실패했다(RED). 아래 '단위' 묶음은 새 모듈을 직접 확인한다(GREEN).

const ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const FALLBACK_SIGNUP_URL = 'https://jober.io/start/ai?src=mcp&client=local';
const KEY_ISSUE_URL = 'https://jober.io/settings/integrations';
const REMOTE_MCP_URL = 'https://api.jober.io/mcp';

/** CONTRACTS 9-9 A-6 shape. 원격 성공을 폴백과 구분하려고 값 일부를 다르게 둔다. */
function remoteGuide(): Record<string, unknown> {
  return {
    product: '자버(Jober): 카카오 알림톡·이메일 발송',
    signupUrl: 'https://dev.jober.io/start/ai?src=mcp&client=local',
    connect: {
      remoteMcpUrl: 'https://dev-api.jober.io/mcp',
      oauth: true,
      localPackage: { name: '@joberhr/jober-mcp', env: ['JOBER_API_KEY'], keyIssueUrl: 'https://dev.jober.io/settings/integrations' },
    },
    channels: [
      { channel: 'EMAIL', status: 'AVAILABLE', note: '가입 후 바로 보낼 수 있어요(선불 차감).' },
      { channel: 'KAKAO', status: 'AVAILABLE', note: '채널 연동 전에는 체험 10건까지.' },
      { channel: 'SMS', status: 'COMING_SOON', note: '문자 발송은 준비 중이에요.' },
    ],
    pricing: { signupBonusKrw: 500, unitCostKrw: 50, prepaidUrl: 'https://dev.jober.io/prepaid', pricingUrl: 'https://dev.jober.io/tour/pricing' },
    firstSendExamples: ['원격 예시 문장'],
    docsUrl: 'https://dev.jober.io/developers/mcp',
  };
}

interface GuideSession {
  client: Client;
  stderr: () => string;
  close: () => Promise<void>;
}

async function openGuideBin(env: Record<string, string>): Promise<GuideSession> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: { ...getDefaultEnvironment(), ...env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const client = new Client({ name: 'guide-test-client', version: '0.0.0' });
  await client.connect(transport);
  return { client, stderr: () => stderr, close: () => client.close() };
}

function firstText(result: Record<string, unknown>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? '';
}

describe('안내 전용 모드(bin, stdio)', () => {
  let remote: MockRemote;
  let sessions: GuideSession[] = [];

  const open = async (env: Record<string, string>) => {
    const session = await openGuideBin(env);
    sessions.push(session);
    return session;
  };

  beforeEach(async () => {
    remote = await startMockRemote();
  });

  afterEach(async () => {
    for (const session of sessions) await session.close();
    sessions = [];
    await remote.close();
  });

  it('키가 없으면 종료하지 않고 get_started 툴 1개만 노출한다', async () => {
    const { client, stderr } = await open({ JOBER_API_BASE: remote.url });
    expect(client.getServerVersion()?.name).toBe('jober-mcp');
    expect(client.getServerVersion()?.title).toBe('Jober (자버) 알림톡·이메일 AI 에이전트');
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('get_started');
    expect(instructions).toContain('JOBER_API_KEY');
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['get_started']);
    // 원격 MCP(/mcp)에는 연결하지 않는다
    expect(remote.requests).toHaveLength(0);
    expect(stderr()).toContain('JOBER_API_KEY');
    expect(stderr()).toContain(KEY_ISSUE_URL);
  });

  it('원격 공개 안내가 성공하면 그 값을 쓴다(키·Authorization 없이 client=local 로 조회)', async () => {
    remote.guide = { body: remoteGuide() };
    const { client } = await open({ JOBER_API_BASE: remote.url });
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.signupUrl).toBe('https://dev.jober.io/start/ai?src=mcp&client=local');
    expect(structured.firstSendExamples).toEqual(['원격 예시 문장']);
    expect(structured.guideSource).toBe('remote');
    const text = firstText(result);
    expect(text).toContain('https://dev.jober.io/start/ai?src=mcp&client=local');
    expect(text).toContain('https://dev.jober.io/settings/integrations');
    expect(text).toContain('https://dev-api.jober.io/mcp');
    expect(text).toContain('JOBER_API_KEY');

    expect(remote.guideRequests).toHaveLength(1);
    expect(remote.guideRequests[0]?.authorization).toBeUndefined();
    expect(remote.guideRequests[0]?.url).toContain('client=local');
  });

  it('원격 공개 안내가 꺼져 있으면(404) 내장 사본으로 가입·키 발급·설정·OAuth 대안을 안내한다', async () => {
    const { client } = await open({ JOBER_API_BASE: remote.url });
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.guideSource).toBe('fallback');
    expect(structured.signupUrl).toBe(FALLBACK_SIGNUP_URL);
    const text = firstText(result);
    expect(text).toContain(FALLBACK_SIGNUP_URL);
    expect(text).toContain(KEY_ISSUE_URL);
    expect(text).toContain('JOBER_API_KEY');
    expect(text).toContain(REMOTE_MCP_URL);
    expect(text).toContain('OAuth');
    expect(text).toContain('이메일');
    expect(remote.guideRequests).toHaveLength(1);
  });

  it('원격 서버에 닿지 않으면 내장 사본을 쓴다', async () => {
    const downUrl = remote.url;
    await remote.close();
    const { client } = await open({ JOBER_API_BASE: downUrl });
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as Record<string, unknown>).guideSource).toBe('fallback');
    expect(firstText(result)).toContain(FALLBACK_SIGNUP_URL);
    remote = await startMockRemote();
  });

  it('원격 응답이 깨졌거나 가입 링크가 고정 경로가 아니면 내장 사본을 쓴다', async () => {
    remote.guide = { raw: '{not json' };
    const broken = await open({ JOBER_API_BASE: remote.url });
    const brokenResult = await broken.client.callTool({ name: 'get_started', arguments: {} });
    expect((brokenResult.structuredContent as Record<string, unknown>).signupUrl).toBe(FALLBACK_SIGNUP_URL);

    remote.guide = {
      body: { ...remoteGuide(), signupUrl: 'https://jober.io/start/ai?src=mcp&client=local&redirectUrl=https://evil.example' },
    };
    const redirect = await open({ JOBER_API_BASE: remote.url });
    const redirectResult = await redirect.client.callTool({ name: 'get_started', arguments: {} });
    expect((redirectResult.structuredContent as Record<string, unknown>).signupUrl).toBe(FALLBACK_SIGNUP_URL);
    expect(firstText(redirectResult)).not.toContain('evil.example');

    remote.guide = { body: { ...remoteGuide(), connect: 'oops' } };
    const wrongShape = await open({ JOBER_API_BASE: remote.url });
    const wrongResult = await wrongShape.client.callTool({ name: 'get_started', arguments: {} });
    expect((wrongResult.structuredContent as Record<string, unknown>).guideSource).toBe('fallback');
  });

  it('키 형식이 틀리면 안내 모드로 시작하고 키 값은 어디에도 남기지 않는다', async () => {
    const badKey = 'jbr_live_xxxxxxxx';
    const { client, stderr } = await open({ JOBER_API_BASE: remote.url, JOBER_API_KEY: badKey });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['get_started']);
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    const text = firstText(result);
    expect(text).toContain('형식');
    expect(text).not.toContain(badKey);
    expect(JSON.stringify(result.structuredContent)).not.toContain(badKey);
    expect(client.getInstructions() ?? '').not.toContain(badKey);
    expect(stderr()).not.toContain(badKey);
    expect(stderr()).toContain('JOBER_API_KEY');
    // 키를 원격으로 보내지 않는다
    expect(remote.requests).toHaveLength(0);
    for (const request of remote.guideRequests) expect(request.authorization).toBeUndefined();
  });

  it('회사 API 키(jbr_co_)는 MCP 에서 쓸 수 없다고 안내한다', async () => {
    const companyKey = `jbr_co_${'A'.repeat(40)}`;
    const { client, stderr } = await open({ JOBER_API_BASE: remote.url, JOBER_API_KEY: companyKey });
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    expect(firstText(result)).toContain('회사 API 키');
    expect(firstText(result)).not.toContain(companyKey);
    expect(stderr()).not.toContain(companyKey);
  });

  it('get_started 외 툴을 부르면 오류 결과로 get_started 를 안내한다', async () => {
    const { client } = await open({ JOBER_API_BASE: remote.url });
    const result = await client.callTool({ name: 'draft_send', arguments: {} });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('get_started');
    expect(firstText(result)).toContain('JOBER_API_KEY');
  });

  it('JOBER_API_BASE 형식 오류는 키가 없어도 지금처럼 종료 코드 1 로 끝난다', () => {
    const run = spawnSync(process.execPath, [ENTRY], {
      env: { ...getDefaultEnvironment(), JOBER_API_BASE: 'http://api.jober.io' },
      input: '',
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('JOBER_API_BASE');
  });
});

describe('안내 전용 모드(단위)', () => {
  let remote: MockRemote;

  beforeEach(async () => {
    remote = await startMockRemote();
  });

  afterEach(async () => {
    await remote.close();
  });

  it('키 모양 판정: 개인 키·OAuth 토큰만 프록시, 없음·형식 오류·회사 키는 안내 모드', () => {
    expect(checkApiKey(VALID_KEY)).toEqual({ ok: true, apiKey: VALID_KEY });
    expect(checkApiKey(`  ${VALID_KEY}  `)).toEqual({ ok: true, apiKey: VALID_KEY });
    expect(checkApiKey(`jbr_at_${'a'.repeat(43)}`).ok).toBe(true);
    expect(checkApiKey(undefined)).toEqual({ ok: false, problem: 'MISSING' });
    expect(checkApiKey('   ')).toEqual({ ok: false, problem: 'MISSING' });
    expect(checkApiKey('jbr_live_xxxxxxxx')).toEqual({ ok: false, problem: 'INVALID_FORMAT' });
    expect(checkApiKey('${input:jober-api-key}')).toEqual({ ok: false, problem: 'INVALID_FORMAT' });
    expect(checkApiKey(`Bearer ${VALID_KEY}`)).toEqual({ ok: false, problem: 'INVALID_FORMAT' });
    expect(checkApiKey(`jbr_co_${'A'.repeat(40)}`)).toEqual({ ok: false, problem: 'COMPANY_KEY' });
  });

  it('시작 모드: 잘못된 JOBER_API_BASE 만 ConfigError, 공개 안내 주소는 <base>/ai-agent/v2/public/getting-started?client=local', () => {
    expect(() => loadStartupConfig({ JOBER_API_BASE: 'http://api.jober.io' })).toThrow(ConfigError);
    const guide = loadStartupConfig({});
    expect(guide.mode).toBe('guide');
    if (guide.mode === 'guide') {
      expect(guide.config.keyProblem).toBe('MISSING');
      expect(guide.config.gettingStartedUrl.toString()).toBe('https://api.jober.io/ai-agent/v2/public/getting-started?client=local');
    }
    expect(resolveGettingStartedUrl(new URL('http://localhost:4100/api/mcp')).toString()).toBe(
      'http://localhost:4100/api/ai-agent/v2/public/getting-started?client=local',
    );
    const proxy = loadStartupConfig({ JOBER_API_KEY: VALID_KEY });
    expect(proxy.mode).toBe('proxy');
    // 프록시 전용 loadConfig 는 키 문제를 ConfigError 로 알린다(키 값은 넣지 않음)
    expect(() => loadConfig({ JOBER_API_KEY: 'jbr_live_xxxxxxxx' })).toThrow(/형식/);
    expect(() => loadConfig({ JOBER_API_KEY: 'jbr_live_xxxxxxxx' })).not.toThrow(/jbr_live_xxxxxxxx/);
  });

  it('내장 사본은 공개 안내 계약 shape 이고 가입 링크는 고정 경로(client=local), 주소는 모두 https jober 도메인이다', () => {
    const guide = loadFallbackGuide();
    expect(isGettingStarted(guide)).toBe(true);
    expect(guide.signupUrl).toBe(SIGNUP_URL);
    expect(guide.connect).toEqual({
      remoteMcpUrl: REMOTE_MCP_URL,
      oauth: true,
      localPackage: { name: '@joberhr/jober-mcp', env: ['JOBER_API_KEY'], keyIssueUrl: KEY_ISSUE_URL },
    });
    expect(guide.channels.map((item) => item.channel)).toEqual(['EMAIL', 'KAKAO', 'SMS']);
    expect(guide.channels.find((item) => item.channel === 'SMS')?.status).toBe('COMING_SOON');
    const urls = [guide.signupUrl, guide.docsUrl, guide.connect.remoteMcpUrl, guide.connect.localPackage.keyIssueUrl, guide.pricing.prepaidUrl, guide.pricing.pricingUrl];
    for (const value of urls) expect(new URL(value).origin).toMatch(/^https:\/\/(api\.)?jober\.io$/);
  });

  it('가입 링크 검사: /start/ai + src=mcp + client 만 허용한다', () => {
    expect(isFixedSignupUrl('https://jober.io/start/ai?src=mcp&client=local')).toBe(true);
    expect(isFixedSignupUrl('http://localhost:3108/start/ai?src=mcp&client=claude')).toBe(true);
    expect(isFixedSignupUrl('https://jober.io/start/ai?src=mcp&client=local&redirectUrl=//evil.example')).toBe(false);
    expect(isFixedSignupUrl('https://jober.io/login?redirectUrl=https://evil.example')).toBe(false);
    expect(isFixedSignupUrl('https://jober.io/start/ai?client=local')).toBe(false);
    expect(isFixedSignupUrl('https://jober.io/start/ai?src=mcp&src=mcp')).toBe(false);
    expect(isFixedSignupUrl('javascript:alert(1)')).toBe(false);
  });

  it('원격이 늦으면(시간 초과) 429 면 폴백으로 간다', async () => {
    const url = resolveGettingStartedUrl(new URL(`${remote.url}/mcp`));
    remote.guide = { body: { ok: true }, delayMs: 500 };
    expect(await fetchGettingStarted(url, { timeoutMs: 100 })).toBeUndefined();
    remote.guide = { status: 429, body: { errorCode: 'J_41_20_4_3', data: { retryAfterSec: 30 } } };
    expect(await fetchGettingStarted(url)).toBeUndefined();
  });

  it('createGuideServer: 결과에 keyStatus·guideSource 를 싣고 다른 툴은 isError 로 막는다', async () => {
    remote.guide = { body: remoteGuide() };
    const startup = loadStartupConfig({ JOBER_API_BASE: remote.url, JOBER_API_KEY: `jbr_co_${'B'.repeat(40)}` });
    if (startup.mode !== 'guide') throw new Error('guide mode expected');
    const server = createGuideServer(startup.config, '0.0.0-test');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'unit', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: 'get_started', arguments: {} });
      expect(result.structuredContent).toMatchObject({ guideSource: 'remote', keyStatus: 'COMPANY_KEY' });
      const other = await client.callTool({ name: 'submit_send', arguments: {} });
      expect(other.isError).toBe(true);
      expect(remote.requests).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});

describe('내장 사본 ↔ 원격 확정 응답(jober-api f8f2c42d2, fix1-api fix5)', () => {
  // test/fixtures/remote-getting-started.json = jober-api f8f2c42d2 buildGettingStarted 실제 출력(운영 주소, client=claude, 이메일 켜짐, A안)
  const remoteExample = (): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL('./fixtures/remote-getting-started.json', import.meta.url), 'utf8')) as Record<string, unknown>;

  it('실제 서버 응답 예시가 shape 검증을 통과한다', () => {
    expect(isGettingStarted(remoteExample())).toBe(true);
  });

  it('내장 사본은 원격 확정 응답과 signupUrl(client=local)만 다르고 키 순서까지 같다', () => {
    const expected = { ...remoteExample(), signupUrl: SIGNUP_URL };
    const fallback = loadFallbackGuide();
    expect(fallback).toEqual(expected);
    expect(JSON.stringify(fallback)).toBe(JSON.stringify(expected));
  });
});

describe('get_started 야간 규칙(jober-api 97d3c4e8a fix3·fix4)', () => {
  let remote: MockRemote;

  beforeEach(async () => {
    remote = await startMockRemote();
  });

  afterEach(async () => {
    await remote.close();
  });

  const callGetStarted = async () => {
    const startup = loadStartupConfig({ JOBER_API_BASE: remote.url });
    if (startup.mode !== 'guide') throw new Error('guide mode expected');
    const server = createGuideServer(startup.config, '0.0.0-test');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'night', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      return await client.callTool({ name: 'get_started', arguments: {} });
    } finally {
      await client.close();
    }
  };

  const expectNightRules = (text: string) => {
    expect(text).toContain('이메일은 밤에도 자동 예약 없이 바로 보내요');
    expect(text).toContain('광고성 알림톡이 밤 9시~아침 8시(한국 시간)에 걸리면 예약 시각 이후 첫 08:00(한국 시간)으로 자동 예약해요');
    expect(text).toContain('정보성 알림톡은 바로 보내요');
    // fix5: 알림톡 링크·광고 3명 상한은 스페이스 누적
    expect(text).toContain('외부 링크·광고 쿠폰은 스페이스 누적 3명까지');
  };

  it('내장 사본(원격 404)으로 안내해도 채널별 야간 규칙이 들어간다', async () => {
    const result = await callGetStarted();
    expect((result.structuredContent as Record<string, unknown>).guideSource).toBe('fallback');
    expectNightRules(firstText(result));
  });

  it('원격 실제 응답(fixture)으로 안내하면 채널별 야간 규칙이 들어간다', async () => {
    const body = JSON.parse(readFileSync(new URL('./fixtures/remote-getting-started.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    remote.guide = { body: { ...body, signupUrl: SIGNUP_URL } };
    const result = await callGetStarted();
    expect((result.structuredContent as Record<string, unknown>).guideSource).toBe('remote');
    expectNightRules(firstText(result));
  });
});
