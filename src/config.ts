export const DEFAULT_API_BASE = 'https://api.jober.io';
export const KEY_ISSUE_URL = 'https://jober.io/settings/integrations';
/**
 * MCP 가입 링크(유입 표식 src=mcp, 로컬 패키지 client=local). 받는 쪽이 외부 주소로 보내는 파라미터가 없는 고정 경로다
 * (CONTRACTS.md 9-2 links.signup, PLAN-v5 B-1·F-1).
 */
export const SIGNUP_URL = 'https://jober.io/start/ai?src=mcp&client=local';
/** 원격 공개 안내(정본, CONTRACTS.md 9-9 A-6) 경로. JOBER_API_BASE 기준. */
export const GETTING_STARTED_PATH = '/ai-agent/v2/public/getting-started';

export interface ProxyConfig {
  /** 원격 jober MCP 엔드포인트 (예: https://api.jober.io/mcp) */
  endpoint: URL;
  /** Authorization: Bearer 로 보낼 API 키 */
  apiKey: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * JOBER_API_BASE 를 원격 MCP 엔드포인트 URL 로 바꾼다.
 * - 값이 없으면 https://api.jober.io/mcp
 * - 경로가 /mcp 로 끝나면 그대로, 아니면 /mcp 를 붙인다.
 * - API 키가 평문으로 나가지 않도록 https 만 허용한다(localhost 개발 서버만 http 허용).
 */
export function resolveEndpoint(apiBase: string | undefined): URL {
  const raw = (apiBase ?? '').trim() || DEFAULT_API_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`JOBER_API_BASE 값이 올바른 URL 이 아닙니다 / JOBER_API_BASE is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new ConfigError(
      `JOBER_API_BASE 는 https 주소여야 합니다(localhost 만 http 허용) / JOBER_API_BASE must use https (http only for localhost): ${raw}`,
    );
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/mcp') ? path : `${path}/mcp`;
  url.search = '';
  url.hash = '';
  return url;
}

/** 키가 없거나 MCP 에서 쓸 수 없는 모양일 때의 이유. 안내 전용 모드로 시작한다. */
export type KeyProblem = 'MISSING' | 'INVALID_FORMAT' | 'COMPANY_KEY';

// 서버 키 모양(jober-api routes/oauth/domain/credentials.js): 개인 키 jbr_live_ + base62 32자, OAuth access 토큰 jbr_at_ + base62 43자.
// 서버가 길이를 늘려도 막지 않도록 최소 길이만 본다. 회사 키(jbr_co_)는 MCP 에서 401 이다.
const PERSONAL_KEY_PATTERN = /^jbr_live_[0-9A-Za-z]{32,}$/;
const ACCESS_TOKEN_PATTERN = /^jbr_at_[0-9A-Za-z]{43,}$/;
const COMPANY_KEY_PREFIX = 'jbr_co_';

/** 키 값은 돌려주거나 로그에 쓰지 않고, 모양만 판정한다. */
export function checkApiKey(raw: string | undefined): { ok: true; apiKey: string } | { ok: false; problem: KeyProblem } {
  const apiKey = (raw ?? '').trim();
  if (!apiKey) return { ok: false, problem: 'MISSING' };
  if (PERSONAL_KEY_PATTERN.test(apiKey) || ACCESS_TOKEN_PATTERN.test(apiKey)) return { ok: true, apiKey };
  return { ok: false, problem: apiKey.startsWith(COMPANY_KEY_PREFIX) ? 'COMPANY_KEY' : 'INVALID_FORMAT' };
}

export interface GuideConfig {
  /** 원격 jober MCP 엔드포인트(안내 문구용, 연결하지 않는다) */
  endpoint: URL;
  /** 원격 공개 안내(정본) 주소. 키 없이 GET 한다. */
  gettingStartedUrl: URL;
  keyProblem: KeyProblem;
}

export type StartupConfig = { mode: 'proxy'; config: ProxyConfig } | { mode: 'guide'; config: GuideConfig };

/** 원격 MCP 엔드포인트(<base>/mcp)에서 공개 안내 주소(<base>/ai-agent/v2/public/getting-started?client=local)를 만든다. */
export function resolveGettingStartedUrl(endpoint: URL): URL {
  const url = new URL(endpoint.toString());
  url.pathname = `${url.pathname.replace(/\/mcp$/, '')}${GETTING_STARTED_PATH}`;
  url.search = '?client=local';
  return url;
}

/**
 * 시작 모드를 정한다. JOBER_API_BASE 형식 오류만 ConfigError(종료)이고, 키가 없거나 형식이 틀리면 안내 전용 모드다(PLAN-v5 A-7).
 */
export function loadStartupConfig(env: NodeJS.ProcessEnv): StartupConfig {
  const endpoint = resolveEndpoint(env.JOBER_API_BASE);
  const key = checkApiKey(env.JOBER_API_KEY);
  if (key.ok) return { mode: 'proxy', config: { endpoint, apiKey: key.apiKey } };
  return { mode: 'guide', config: { endpoint, gettingStartedUrl: resolveGettingStartedUrl(endpoint), keyProblem: key.problem } };
}

/** 키 문제를 사용자에게 보여 줄 문구(키 값은 넣지 않는다). */
export function describeKeyProblem(problem: KeyProblem): string {
  if (problem === 'COMPANY_KEY') {
    return (
      `JOBER_API_KEY 에 회사 API 키(jbr_co_)가 들어 있습니다. MCP 에는 개인 API 키(jbr_live_)만 쓸 수 있으니 ${KEY_ISSUE_URL} 에서 개인 API 키를 발급하세요. / ` +
      `JOBER_API_KEY holds a company API key (jbr_co_); MCP accepts personal API keys (jbr_live_) only. Create one at ${KEY_ISSUE_URL}.`
    );
  }
  if (problem === 'INVALID_FORMAT') {
    return (
      `JOBER_API_KEY 형식이 올바르지 않습니다(jbr_live_ 로 시작하는 개인 API 키 전체를 넣어야 합니다). ${KEY_ISSUE_URL} 에서 발급한 키를 그대로 붙여 넣으세요. / ` +
      `JOBER_API_KEY has an invalid format (expected a full personal API key starting with jbr_live_). Paste the key issued at ${KEY_ISSUE_URL}.`
    );
  }
  return (
    `JOBER_API_KEY 환경 변수가 없습니다. ${KEY_ISSUE_URL} 에서 API 키를 발급해 설정하세요. 자버 계정이 없으면 ${SIGNUP_URL} 에서 가입하세요. / ` +
    `JOBER_API_KEY is not set. Create an API key at ${KEY_ISSUE_URL} (sign up at ${SIGNUP_URL} if you have no Jober account).`
  );
}

/** 프록시 설정만 받는다(키가 MCP 에서 쓸 수 있는 모양이 아니면 ConfigError). */
export function loadConfig(env: NodeJS.ProcessEnv): ProxyConfig {
  const startup = loadStartupConfig(env);
  if (startup.mode === 'guide') throw new ConfigError(describeKeyProblem(startup.config.keyProblem));
  return startup.config;
}
