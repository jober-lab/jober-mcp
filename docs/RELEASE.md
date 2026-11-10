# Releasing @joberhr/jober-mcp

This package is a thin stdio proxy to the Jober remote MCP server (`https://api.jober.io/mcp`).

## Checklist
1. The remote MCP server must already serve the features described in the instructions. The remote `/mcp`, OAuth and getting-started endpoints have no on/off switch: they are open as soon as the server version that contains them is deployed. Only SMS stays behind a server switch, so the instructions must describe SMS as coming soon until it is turned on.
2. `src/proxy.ts` INSTRUCTIONS must be byte-identical to the remote server's instructions (enforced by `npm test`). When the remote text changes, update the copy and fixtures together.
3. `guide-fallback.json` is the offline copy used in guide-only mode (no API key). Keep it in sync with what the remote server currently allows.
4. Bump `version` in both `package.json` and `server.json` (`version` and `packages[0].version` must match the npm version).
5. `npm run build && npm publish --access public` (`prepublishOnly` runs the tests). Publishing requires an npm account with publish rights on the `@joberhr` scope (2FA).
6. Publish the registry entry under the `io.jober` namespace (server name `io.jober/jober-mcp`, same as `mcpName` in `package.json`). The namespace is proven with HTTP domain auth: `https://jober.io/.well-known/mcp-registry-auth` serves `v=MCPv1; k=ed25519; p=<public key>` (shipped by jober-client). Log in with `mcp-publisher login http --domain jober.io --private-key <hex private key>` then run `mcp-publisher publish`. Keep the Ed25519 private key outside the repository and never commit or print it.

## Order
Remote server deploy → npm publish → MCP Registry publish. There is no separate "enable" step on the remote server. Publishing the package before the remote server version is deployed makes users hit a server that does not have the tools yet (older servers answer 403 `J_41_25_3_1`, which this package still explains).
