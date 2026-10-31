import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { KEY_ISSUE_URL, type ProxyConfig } from './config.js';

export const SERVER_NAME = 'jober-mcp';

const INSTRUCTIONS = [
  'jober(자버) 카카오 알림톡 캠페인 도구입니다. 문자 원문을 알림톡 캠페인으로 변환하고, 설문 랜딩·수신자 등록·발송·결과 조회를 합니다.',
  '실제 발송은 반드시 prepare_send 로 대상 수·예상 비용·미리보기를 사용자에게 보여 준 뒤, 사용자가 확인하면 submit_send 를 호출하세요.',
  'submit_send 에는 prepare_send 가 돌려준 operationUuid·confirmHash 와 새 idempotencyKey 가 필요하며, 같은 키로 다시 호출해도 한 번만 발송됩니다.',
  'Jober KakaoTalk campaign tools. Always call prepare_send and show the summary to the user before submit_send.',
].join('\n');

/** 원격이 JSON-RPC 오류로 응답한 경우(툴 인자 오류 등). 그대로 전달한다. */
function isRemoteRpcError(error: unknown): error is McpError {
  return error instanceof McpError && error.code !== ErrorCode.ConnectionClosed;
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** 원격 연결 실패를 사용자가 바로 조치할 수 있는 문구로 바꾼다. */
export function describeRemoteError(error: unknown, endpoint: URL): string {
  const target = endpoint.toString();
  if (error instanceof StreamableHTTPError) {
    const status = error.code ?? 0;
    const detail = truncate(error.message);
    if (status === 401) {
      return (
        `jober API 키 인증에 실패했습니다(HTTP 401). JOBER_API_KEY 가 올바른지, 폐기되지 않았는지 확인하고 ${KEY_ISSUE_URL} 에서 새 키를 발급하세요. / ` +
        `Authentication failed (HTTP 401): check JOBER_API_KEY or create a new key at ${KEY_ISSUE_URL}. (${detail})`
      );
    }
    if (status === 403) {
      return (
        `권한이 없습니다(HTTP 403). API 키 권한(scope)과 스페이스의 MCP 사용 설정을 확인하세요. / ` +
        `Forbidden (HTTP 403): check the API key scopes and that MCP is enabled for the space. (${detail})`
      );
    }
    if (status === 404) {
      return (
        `원격 jober MCP 엔드포인트를 찾을 수 없습니다(HTTP 404): ${target}. JOBER_API_BASE 값을 확인하세요. / ` +
        `Remote MCP endpoint not found (HTTP 404): ${target}. Check JOBER_API_BASE.`
      );
    }
    if (status === 429) {
      return `요청이 너무 많습니다(HTTP 429). 잠시 후 다시 시도하세요. / Too many requests (HTTP 429), retry later. (${detail})`;
    }
    if (status >= 500) {
      return (
        `원격 jober MCP 서버 오류입니다(HTTP ${status}). 잠시 후 다시 시도하세요. / ` +
        `Remote jober MCP server error (HTTP ${status}), retry later. (${detail})`
      );
    }
    return `원격 jober MCP 요청이 실패했습니다(${target}). / Remote jober MCP request failed. (${detail})`;
  }
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
  const reason = truncate([error instanceof Error ? error.message : String(error), cause?.message].filter(Boolean).join(': '));
  return (
    `원격 jober MCP 서버(${target})에 연결할 수 없습니다. 네트워크와 JOBER_API_BASE 값을 확인하세요. / ` +
    `Cannot reach the remote jober MCP server (${target}). Check your network and JOBER_API_BASE. (${reason})`
  );
}

export interface ProxyServer {
  server: Server;
  /** 원격 연결을 닫는다(로컬 클라이언트 종료 시). */
  closeRemote(): Promise<void>;
}

/**
 * stdio 쪽에 붙일 MCP 서버를 만든다. tools/list·tools/call 을 원격 jober MCP(Streamable HTTP)로 그대로 넘긴다.
 * 원격 연결은 첫 요청 때 맺고, 전송 오류가 나면 끊어서 다음 요청에서 다시 연결한다.
 * 부작용이 있는 툴(submit_send 등)이 중복 실행되지 않도록 실패한 호출은 자동 재시도하지 않는다.
 */
export function createProxyServer(config: ProxyConfig, version: string): ProxyServer {
  let remote: Promise<Client> | undefined;

  const connectRemote = async (): Promise<Client> => {
    const client = new Client({ name: SERVER_NAME, version });
    const transport = new StreamableHTTPClientTransport(config.endpoint, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'User-Agent': `${SERVER_NAME}/${version}`,
        },
      },
    });
    try {
      await client.connect(transport);
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  };

  const getRemote = (): Promise<Client> => {
    if (!remote) {
      const pending = connectRemote();
      remote = pending;
      pending.catch(() => {
        if (remote === pending) remote = undefined;
      });
    }
    return remote;
  };

  const closeRemote = async (): Promise<void> => {
    const current = remote;
    remote = undefined;
    if (current) {
      await current.then((client) => client.close()).catch(() => undefined);
    }
  };

  const server = new Server({ name: SERVER_NAME, version }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    try {
      const client = await getRemote();
      return await client.request({ method: 'tools/list', params: request.params }, ListToolsResultSchema, {
        signal: extra.signal,
      });
    } catch (error) {
      if (isRemoteRpcError(error)) throw error;
      await closeRemote();
      throw new McpError(ErrorCode.InternalError, describeRemoteError(error, config.endpoint));
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const progressToken = request.params._meta?.progressToken;
    const options: RequestOptions = { signal: extra.signal };
    if (progressToken !== undefined) {
      options.onprogress = (progress) => {
        void extra.sendNotification({ method: 'notifications/progress', params: { ...progress, progressToken } });
      };
    }
    try {
      const client = await getRemote();
      return await client.request({ method: 'tools/call', params: request.params }, CallToolResultSchema, options);
    } catch (error) {
      if (isRemoteRpcError(error)) throw error;
      await closeRemote();
      return {
        content: [{ type: 'text', text: describeRemoteError(error, config.endpoint) }],
        isError: true,
      };
    }
  });

  return { server, closeRemote };
}
