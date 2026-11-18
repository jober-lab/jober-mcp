# Releasing @joberhr/jober-mcp

This package is a thin stdio proxy to the Jober remote MCP server (`https://api.jober.io/mcp`).
It ships in three forms: the npm package, the MCP Registry entry (`io.jober/jober-mcp`) and a Claude Desktop Extension (`jober-mcp.mcpb`, GitHub Release asset).

## Checklist
1. The remote MCP server must already serve the features described in the instructions. The remote `/mcp`, OAuth and getting-started endpoints have no on/off switch: they are open as soon as the server version that contains them is deployed. Only SMS stays behind a server switch, so the instructions must describe SMS as coming soon until it is turned on.
2. `src/proxy.ts` INSTRUCTIONS must be byte-identical to the remote server's instructions (enforced by `npm test` with `test/fixtures/remote-instructions.txt`). When the remote text changes, update the copy and fixtures together. Keep it at 4,096 characters or less (Claude Code truncates server instructions there; the test checks it).
3. `guide-fallback.json` is the offline copy used in guide-only mode (no API key, or a key rejected with HTTP 401). Keep it in sync with what the remote server currently allows.
4. Bump `version` in `package.json`, `package-lock.json` and `server.json` (`version` and `packages[0].version` must match the npm version). `npm version <x.y.z> --no-git-tag-version` updates the first two. The `.mcpb` manifest takes its version from `package.json` at build time.
5. `npm run build && npm publish --access public` (`prepublishOnly` runs the tests). Publishing requires an npm account with publish rights on the `@joberhr` scope (2FA).
6. Publish the registry entry under the `io.jober` namespace (server name `io.jober/jober-mcp`, same as `mcpName` in `package.json`). The namespace is proven with HTTP domain auth: `https://jober.io/.well-known/mcp-registry-auth` serves `v=MCPv1; k=ed25519; p=<public key>` (shipped by jober-client). Log in with `mcp-publisher login http --domain jober.io --private-key <hex private key>` then run `mcp-publisher publish`. Keep the Ed25519 private key outside the repository and never commit or print it.
7. Build and publish the Claude Desktop Extension:
   - `npm ci && npm run build:mcpb` builds `build/jober-mcp.mcpb` (runs `npm run build`, stages `dist` + production `node_modules` + `mcpb/manifest.json` + `mcpb/icon.png`, then `mcpb validate` and `mcpb pack`). It prints the size and sha256.
   - Smoke test: install the file in Claude Desktop (double-click, or drag it onto Settings > Extensions), leave the key empty and check that `get_started` appears, then set a personal key and check that the tools appear.
   - Create a GitHub Release `v<x.y.z>` and upload the file with the exact asset name `jober-mcp.mcpb`, marked as the latest release:
     `gh release create v<x.y.z> build/jober-mcp.mcpb --repo jober-lab/jober-mcp --title "v<x.y.z>" --notes "<notes>" --latest`
   - The fixed download URL used by jober.io docs and settings pages is `https://github.com/jober-lab/jober-mcp/releases/latest/download/jober-mcp.mcpb`. Do not rename the asset. It returns 404 until the first Release with this asset exists, so the web pages that link it must go live after the Release.
   - Claude Desktop does not auto-update `.mcpb` installs; users reinstall from the same URL. The Claude connector directory does not accept `.mcpb` submissions (2026-11), so this is direct distribution only.

## Order
Remote server deploy → npm publish → MCP Registry publish → GitHub Release (`jober-mcp.mcpb`) → web pages that link the `.mcpb` URL. There is no separate "enable" step on the remote server. Publishing the package before the remote server version is deployed makes users hit a server that does not have the tools yet (older servers answer 403 `J_41_25_3_1`, which this package still explains). This package also works against older servers for the onboarding changes in 0.7.0: a 401 without the Korean `jober` block falls back to the packaged message, and a 403 `insufficient_scope` is explained as "create a new key".
