#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { createProxyServer } from './proxy.js';

// stdout 은 MCP 프로토콜 전용이므로 안내·오류는 모두 stderr 로 쓴다.
async function main(): Promise<void> {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const config = loadConfig(process.env);
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
