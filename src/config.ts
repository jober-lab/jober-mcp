export const DEFAULT_API_BASE = 'https://api.jober.io';
export const KEY_ISSUE_URL = 'https://jober.io/settings/integrations';

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

export function loadConfig(env: NodeJS.ProcessEnv): ProxyConfig {
  const apiKey = (env.JOBER_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new ConfigError(
      `JOBER_API_KEY 환경 변수가 없습니다. ${KEY_ISSUE_URL} 에서 API 키를 발급해 설정하세요. / ` +
        `JOBER_API_KEY is not set. Create an API key at ${KEY_ISSUE_URL}.`,
    );
  }
  return { endpoint: resolveEndpoint(env.JOBER_API_BASE), apiKey };
}
