# Releasing @joberhr/jober-mcp

This package is a thin stdio proxy to the Jober remote MCP server (`https://api.jober.io/mcp`).

## Checklist
1. The remote MCP server must already serve the features described in the instructions.
2. `src/proxy.ts` INSTRUCTIONS must be byte-identical to the remote server's instructions (enforced by `npm test`). When the remote text changes, update the copy and fixtures together.
3. `guide-fallback.json` is the offline copy used in guide-only mode (no API key). Keep it in sync with what the remote server currently allows.
4. Bump `version` in both `package.json` and `server.json` (`version` and `packages[0].version` must match the npm version).
5. `npm run build && npm publish --access public` (`prepublishOnly` runs the tests). Publishing requires an npm account with publish rights on the `@joberhr` scope (2FA).
6. Publish the registry entry with `mcp-publisher login github` then `mcp-publisher publish` (namespace `io.github.jober-lab`).

## Order
Remote server deploy → remote feature enabled → npm publish → MCP Registry publish. Publishing the package before the remote server is open makes users see 403 responses.
