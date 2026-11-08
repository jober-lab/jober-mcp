import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

// 서버 키 모양과 같게 jbr_live_ + base62 32자(로컬 형식 검사 통과)
export const VALID_KEY = 'jbr_live_TESTKEY0000000000000000000000000';
export const GUIDE_PATH = '/ai-agent/v2/public/getting-started';

// CONTRACTS.md 6장 툴 목록
export const CONTRACT_TOOLS = [
  'convert_message',
  'get_campaign',
  'update_campaign',
  'list_templates',
  'list_surveys',
  'generate_survey',
  'select_survey',
  'get_job',
  'preview_recipients',
  'commit_recipients',
  'prepare_send',
  'submit_send',
  'cancel_scheduled_send',
  'get_campaign_results',
  'prepare_reminder',
  'list_campaigns',
];

const PAGE_SIZE = 10;

export interface RecordedRequest {
  authorization: string | undefined;
  userAgent: string | undefined;
  body: unknown;
}

export interface GuideResponse {
  status?: number;
  /** JSON 으로 보낼 본문(raw 가 있으면 무시) */
  body?: unknown;
  /** 그대로 보낼 문자열 본문(깨진 JSON 재현) */
  raw?: string;
  /** 응답 지연(타임아웃 재현) */
  delayMs?: number;
}

export interface MockRemote {
  url: string;
  requests: RecordedRequest[];
  /** 지정하면 모든 POST 에 이 HTTP 상태로 응답한다(장애 재현). */
  forceStatus: number | undefined;
  /** forceStatus 와 함께 보낼 JSON 본문(없으면 {message:'mock failure'}) */
  forceBody: unknown;
  /** 공개 안내(getting-started) 응답. 없으면 404(플래그 꺼짐과 같음). */
  guide: GuideResponse | undefined;
  /** 공개 안내 요청 기록 */
  guideRequests: Array<{ url: string; authorization: string | undefined }>;
  close(): Promise<void>;
}

function buildServer(): Server {
  const server = new Server({ name: 'mock-jober-remote', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, (request) => {
    const start = request.params?.cursor === 'page2' ? PAGE_SIZE : 0;
    const tools = CONTRACT_TOOLS.slice(start, start + PAGE_SIZE).map((name) => ({
      name,
      description: `mock ${name}`,
      inputSchema: { type: 'object' as const, properties: { campaignUuid: { type: 'string' } } },
    }));
    return start === 0 ? { tools, nextCursor: 'page2' } : { tools };
  });
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name, arguments: args = {} } = request.params;
    if (!CONTRACT_TOOLS.includes(name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    if (name === 'submit_send' && !args.idempotencyKey) {
      return { content: [{ type: 'text', text: 'idempotencyKey 가 필요합니다' }], isError: true };
    }
    return {
      content: [{ type: 'text', text: `${name} ok` }],
      structuredContent: { tool: name, echo: args },
    };
  });
  return server;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/** 원격 jober MCP 를 흉내 내는 stateless + JSON 응답 모드 Streamable HTTP 서버. */
export async function startMockRemote(): Promise<MockRemote> {
  const requests: RecordedRequest[] = [];
  const guideRequests: MockRemote['guideRequests'] = [];
  const mock = {
    forceStatus: undefined as number | undefined,
    forceBody: undefined as unknown,
    guide: undefined as GuideResponse | undefined,
  };

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && (req.url ?? '').split('?')[0] === GUIDE_PATH) {
        guideRequests.push({ url: req.url ?? '', authorization: req.headers.authorization });
        const guide = mock.guide;
        if (guide?.delayMs) await new Promise((resolve) => setTimeout(resolve, guide.delayMs));
        if (!guide) {
          res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ errorCode: 'J_41_20_1_3' }));
          return;
        }
        res.writeHead(guide.status ?? 200, { 'Content-Type': 'application/json' }).end(guide.raw ?? JSON.stringify(guide.body));
        return;
      }
      if (req.url !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' }).end();
        return;
      }
      const body = await readBody(req);
      requests.push({ authorization: req.headers.authorization, userAgent: req.headers['user-agent'], body });
      if (mock.forceStatus) {
        res.writeHead(mock.forceStatus, { 'Content-Type': 'application/json' }).end(JSON.stringify(mock.forceBody ?? { message: 'mock failure' }));
        return;
      }
      if (req.headers.authorization !== `Bearer ${VALID_KEY}`) {
        res
          .writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer resource_metadata="https://api.jober.io/.well-known/oauth-protected-resource"',
          })
          .end(JSON.stringify({ message: 'invalid token' }));
        return;
      }
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  return Object.assign(mock, {
    url: `http://127.0.0.1:${port}`,
    requests,
    guideRequests,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  });
}
