import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, KEY_ISSUE_URL, loadConfig, resolveEndpoint } from '../src/config.js';
import { createProxyServer, type ProxyServer } from '../src/proxy.js';
import { CONTRACT_TOOLS, startMockRemote, VALID_KEY, type MockRemote } from './mockRemote.js';

const VERSION = '0.0.0-test';
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

  it('잘못된 키(401)는 키 발급 위치와 함께 명확한 오류를 준다', async () => {
    const client = await open(remote.url, 'jbr_live_WRONG');
    const listError = await client.listTools().catch((e: unknown) => e);
    expect(listError).toBeInstanceOf(McpError);
    expect((listError as McpError).message).toContain('HTTP 401');
    expect((listError as McpError).message).toContain(KEY_ISSUE_URL);

    const result = await client.callTool({ name: 'list_campaigns', arguments: {} });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('HTTP 401');
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

  it('JOBER_API_KEY 가 없으면 stderr 로 안내하고 종료 코드 1 로 끝난다', () => {
    const run = spawnSync(process.execPath, [ENTRY], {
      env: { ...getDefaultEnvironment(), JOBER_API_BASE: remote.url },
      input: '',
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('JOBER_API_KEY');
    expect(run.stderr).toContain(KEY_ISSUE_URL);
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
});
