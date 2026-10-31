import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

export const VALID_KEY = 'jbr_live_TESTKEY0000000000000000000000';

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

export interface MockRemote {
  url: string;
  requests: RecordedRequest[];
  /** 지정하면 모든 POST 에 이 HTTP 상태로 응답한다(장애 재현). */
  forceStatus: number | undefined;
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
  const mock = { forceStatus: undefined as number | undefined };

  const httpServer = http.createServer((req, res) => {
    void (async () => {
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
        res.writeHead(mock.forceStatus, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'mock failure' }));
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
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  });
}
