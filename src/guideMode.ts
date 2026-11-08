import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describeKeyProblem, type GuideConfig, type KeyProblem } from './config.js';
import { SERVER_NAME, SERVER_TITLE } from './proxy.js';

/**
 * 안내 전용 모드(PLAN-v5 A-7). JOBER_API_KEY 가 없거나 MCP 에서 쓸 수 없는 모양이면 종료하지 않고 get_started 툴 1개만 띄운다.
 * - get_started 는 원격 공개 안내(정본, CONTRACTS.md 9-9 A-6)를 키 없이 조회하고, 실패하면 패키지에 동봉한 사본(guide-fallback.json)을 쓴다.
 * - 원격 MCP(/mcp)에는 연결하지 않고, 키 값은 어디에도 싣지 않는다.
 */

export const GUIDE_TOOL_NAME = 'get_started';
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_BODY_BYTES = 64 * 1024;

export interface GuideChannel {
  channel: string;
  status: string;
  note: string;
}

/** 원격 공개 안내 응답(CONTRACTS.md 9-9 A-6). 원격 값에 필드가 더 있으면 그대로 둔다. */
export interface GettingStarted {
  product: string;
  signupUrl: string;
  connect: {
    remoteMcpUrl: string;
    oauth: boolean;
    localPackage: { name: string; env: string[]; keyIssueUrl: string };
  };
  channels: GuideChannel[];
  pricing: { signupBonusKrw: number; unitCostKrw: number; prepaidUrl: string; pricingUrl: string };
  firstSendExamples: string[];
  docsUrl: string;
  /** v6 진행 방식(키 맨 뒤, 옛 원격에는 없을 수 있다) */
  howItWorks?: string[];
}

export type GuideSource = 'remote' | 'fallback';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function isWebUrl(value: unknown): value is string {
  if (!isString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** 가입 링크는 /start/ai 고정 경로 + src·client 만 허용한다(다른 곳으로 보내는 파라미터가 끼면 오픈 리다이렉트 위험, PLAN-v5 F-1). */
export function isFixedSignupUrl(value: unknown): value is string {
  if (!isWebUrl(value)) return false;
  const url = new URL(value);
  if (url.pathname !== '/start/ai' || url.hash || url.username || url.password) return false;
  const keys = [...url.searchParams.keys()];
  return url.searchParams.get('src') === 'mcp' && keys.every((key) => key === 'src' || key === 'client') && new Set(keys).size === keys.length;
}

/** 원격 응답이 계약 shape 인지 확인한다. 아니면 폴백을 쓴다. */
export function isGettingStarted(value: unknown): value is GettingStarted {
  if (!isRecord(value)) return false;
  const { connect, pricing, channels } = value;
  if (!isString(value.product) || !isFixedSignupUrl(value.signupUrl) || !isWebUrl(value.docsUrl)) return false;
  if (!isRecord(connect) || !isWebUrl(connect.remoteMcpUrl) || typeof connect.oauth !== 'boolean') return false;
  const local = connect.localPackage;
  if (!isRecord(local) || !isString(local.name) || !isStringArray(local.env) || !isWebUrl(local.keyIssueUrl)) return false;
  if (!Array.isArray(channels) || channels.length === 0) return false;
  if (!channels.every((item) => isRecord(item) && isString(item.channel) && isString(item.status) && isString(item.note))) return false;
  if (!isRecord(pricing) || typeof pricing.signupBonusKrw !== 'number' || typeof pricing.unitCostKrw !== 'number') return false;
  if (!isWebUrl(pricing.prepaidUrl) || !isWebUrl(pricing.pricingUrl)) return false;
  return isStringArray(value.firstSendExamples);
}

/** 패키지 동봉 사본(오프라인용). 원격 정본과 같은 shape, 가입 링크 client=local. */
export function loadFallbackGuide(): GettingStarted {
  const parsed: unknown = JSON.parse(readFileSync(new URL('./guide-fallback.json', import.meta.url), 'utf8'));
  if (!isGettingStarted(parsed)) throw new Error('guide-fallback.json 이 공개 안내 계약 shape 와 다릅니다');
  return parsed;
}

export interface FetchGuideOptions {
  timeoutMs?: number;
}

/** 원격 공개 안내를 키 없이 조회한다. 실패(네트워크·비 2xx·깨진 JSON·shape 불일치·시간 초과)는 undefined. */
export async function fetchGettingStarted(url: URL, options: FetchGuideOptions = {}): Promise<GettingStarted | undefined> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return undefined;
    const parsed: unknown = JSON.parse(text);
    return isGettingStarted(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const KEY_STATUS_LABEL: Record<KeyProblem, string> = {
  MISSING: 'JOBER_API_KEY 가 설정되지 않아',
  INVALID_FORMAT: 'JOBER_API_KEY 형식이 올바르지 않아',
  COMPANY_KEY: 'JOBER_API_KEY 에 회사 API 키(jbr_co_)가 들어 있어(MCP 는 개인 API 키만 받습니다)',
};

const CHANNEL_LABEL: Record<string, string> = { EMAIL: '이메일', KAKAO: '카카오 알림톡', SMS: '문자' };
const STATUS_LABEL: Record<string, string> = { AVAILABLE: '가능', COMING_SOON: '준비 중' };

/** 안내 모드 서버 instructions. LLM 이 get_started 를 부르고 사람에게 가입·키 설정을 안내하도록 한다. */
export function guideInstructions(problem: KeyProblem): string {
  return [
    `자버(Jober) MCP 가 안내 전용 모드로 실행 중입니다: ${KEY_STATUS_LABEL[problem]} 발송 툴을 쓸 수 없습니다. ` +
      'get_started 를 호출해 사용자에게 가입과 키 발급 방법을 안내하고, 키를 받으면 MCP 설정의 JOBER_API_KEY 에 넣고 다시 시작하라고 알려 주세요. ' +
      '가입과 키 발급은 사용자가 웹에서 직접 합니다. 키 없이 쓰려면 원격 MCP 주소를 OAuth 로 연결하는 방법도 안내할 수 있습니다.',
    'Jober MCP is running in guide-only mode because JOBER_API_KEY is missing or unusable. Call get_started and relay the signup, ' +
      'API key and setup steps to the user; after they set JOBER_API_KEY, the MCP server must be restarted. Remote MCP with OAuth is an alternative.',
  ].join('\n');
}

/** get_started 결과 텍스트. 가입 링크·키 발급 위치·설정 방법·원격 OAuth 대안을 순서대로 적는다. */
export function renderGuideText(guide: GettingStarted, problem: KeyProblem, source: GuideSource): string {
  const { connect, pricing } = guide;
  const keyName = connect.localPackage.env[0] ?? 'JOBER_API_KEY';
  const lines = [
    `자버(Jober) 시작 안내 / Getting started: ${guide.product}`,
    `현재 상태: ${KEY_STATUS_LABEL[problem]} 안내 전용 모드입니다(get_started 툴만 쓸 수 있음).`,
    ...(problem === 'MISSING' ? [] : [describeKeyProblem(problem)]),
    '',
    `1. 가입(사람이 직접): ${guide.signupUrl}`,
    `2. 개인 API 키 발급(jbr_live_ 로 시작, 한 번만 보임): ${connect.localPackage.keyIssueUrl}`,
    `3. 설정: MCP 클라이언트 설정의 env 에 ${keyName}=<발급한 키> 를 넣고 MCP 서버(또는 AI 도구)를 다시 시작하세요.`,
    `   예(Claude Code): claude mcp add jober -e ${keyName}=<발급한 키> -- npx -y ${connect.localPackage.name}`,
    connect.oauth
      ? `4. 키 없이 연결(OAuth): 원격 MCP 주소 ${connect.remoteMcpUrl} 를 AI 도구에 직접 추가하면 브라우저에서 자버 로그인·연결 승인으로 연결됩니다.`
      : `4. 원격 MCP 주소: ${connect.remoteMcpUrl}`,
    '5. 연결한 뒤에는 get_send_readiness 를 먼저 부르고 onboarding.nextStep 을 따르세요(채널별 실제 사용 가능 여부도 여기서 확인).',
    '',
    '보낼 수 있는 채널:',
    ...guide.channels.map(
      (item) => `- ${CHANNEL_LABEL[item.channel] ?? item.channel}(${item.channel}): ${STATUS_LABEL[item.status] ?? item.status}. ${item.note}`,
    ),
    '',
    `요금: 가입 보너스 ${pricing.signupBonusKrw.toLocaleString('ko-KR')}원, 건당 약 ${pricing.unitCostKrw.toLocaleString('ko-KR')}원(선불 차감). ` +
      `충전 ${pricing.prepaidUrl} · 요금제 ${pricing.pricingUrl}`,
  ];
  if (guide.firstSendExamples.length > 0) {
    lines.push('', '첫 발송 예시:', ...guide.firstSendExamples.map((example) => `- ${example}`));
  }
  if (Array.isArray(guide.howItWorks) && guide.howItWorks.length > 0) {
    lines.push('', '진행 방식:', ...guide.howItWorks.map((item) => `- ${item}`));
  }
  lines.push(
    '',
    `문서: ${guide.docsUrl}`,
    `(안내 출처: ${source === 'remote' ? '자버 서버 공개 안내' : '패키지 내장 사본(자버 서버 공개 안내를 받지 못함)'})`,
    '',
    `English: sign up at ${guide.signupUrl}, create a personal API key at ${connect.localPackage.keyIssueUrl}, ` +
      `set ${keyName} in your MCP client config and restart. Or connect the remote MCP ${connect.remoteMcpUrl} with OAuth (no key needed).`,
  );
  return lines.join('\n');
}

/** 안내 모드 stdio 서버. get_started 툴 1개만 노출한다. */
export function createGuideServer(config: GuideConfig, version: string, options: FetchGuideOptions = {}): Server {
  const server = new Server({ name: SERVER_NAME, title: SERVER_TITLE, version }, { capabilities: { tools: {} }, instructions: guideInstructions(config.keyProblem) });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: GUIDE_TOOL_NAME,
        title: '자버 시작 안내',
        description:
          '자버(Jober) 가입 링크, 개인 API 키 발급 위치, JOBER_API_KEY 설정 방법, 키 없이 쓰는 원격 MCP(OAuth) 연결 방법과 채널·요금을 알려 줍니다. ' +
          'JOBER_API_KEY 가 없거나 형식이 틀려 안내 전용 모드일 때만 있는 툴입니다. / Signup, API key and setup guide for Jober.',
        inputSchema: { type: 'object' as const, properties: {} },
        annotations: { title: '자버 시작 안내', readOnlyHint: true, openWorldHint: true },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== GUIDE_TOOL_NAME) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `지금은 안내 전용 모드라 ${request.params.name} 툴을 쓸 수 없습니다. get_started 를 호출해 가입·키 발급 방법을 확인하고, ` +
              `JOBER_API_KEY 를 설정한 뒤 MCP 서버를 다시 시작하세요. ${describeKeyProblem(config.keyProblem)}`,
          },
        ],
        isError: true,
      };
    }
    const remote = await fetchGettingStarted(config.gettingStartedUrl, options);
    const source: GuideSource = remote ? 'remote' : 'fallback';
    const guide = remote ?? loadFallbackGuide();
    return {
      content: [{ type: 'text' as const, text: renderGuideText(guide, config.keyProblem, source) }],
      structuredContent: { ...guide, guideSource: source, keyStatus: config.keyProblem },
    };
  });

  return server;
}
