#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, describeKeyProblem, loadStartupConfig } from './config.js';
import { createGuideServer } from './guideMode.js';
import { createProxyServer } from './proxy.js';

// stdout 은 MCP 프로토콜 전용이므로 안내·오류는 모두 stderr 로 쓴다. 키 값은 쓰지 않는다.
async function main(): Promise<void> {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const startup = loadStartupConfig(process.env);
  if (startup.mode === 'guide') {
    // 키가 없거나 쓸 수 없는 모양이면 종료하지 않고 get_started 툴 1개만 띄운다(PLAN-v5 A-7).
    const server = createGuideServer(startup.config, version);
    await server.connect(new StdioServerTransport());
    process.stderr.write(
      `[jober-mcp] ${version} guide mode (get_started only): ${describeKeyProblem(startup.config.keyProblem)}\n` +
        `[jober-mcp] JOBER_API_KEY 를 설정한 뒤 MCP 서버를 다시 시작하면 발송 툴을 쓸 수 있습니다. / Set JOBER_API_KEY and restart to enable the tools.\n`,
    );
    return;
  }
  const { config } = startup;
  const { server, closeRemote } = createProxyServer(config, version);
  server.onclose = () => {
    void closeRemote();
  };
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[jober-mcp] ${version} ready, proxying to ${config.endpoint.toString()}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError ? error.message : error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[jober-mcp] ${message}\n`);
  process.exit(1);
});
