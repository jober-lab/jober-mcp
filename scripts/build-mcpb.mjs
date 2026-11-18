#!/usr/bin/env node
// Claude Desktop Extension(.mcpb) 빌드: build/jober-mcp.mcpb
// - mcpb/manifest.json(버전은 package.json 값으로 채움) + dist + 운영 의존성(node_modules, devDependencies 제외) + 아이콘·README·LICENSE
// - Claude Desktop 내장 Node 로 dist/index.js 를 실행하고, 설치 창의 '자버 개인 API 키'(user_config.jober_api_key, sensitive)를 JOBER_API_KEY 로 넘긴다.
// - 배포: GitHub Release 자산 jober-mcp.mcpb(고정 주소 https://github.com/jober-lab/jober-mcp/releases/latest/download/jober-mcp.mcpb).
//   Release 생성·업로드는 이 스크립트가 하지 않는다(docs/RELEASE.md, 오너 승인 후).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, 'build', 'mcpb');
const output = join(root, 'build', 'jober-mcp.mcpb');
const isWindows = process.platform === 'win32';

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: isWindows });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 실패(exit ${result.status})`);
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

run('npm', ['run', 'build']);

rmSync(stage, { recursive: true, force: true });
rmSync(output, { force: true });
mkdirSync(stage, { recursive: true });

cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'README.md', 'LICENSE']) {
  cpSync(join(root, file), join(stage, file));
}
cpSync(join(root, 'mcpb', 'icon.png'), join(stage, 'icon.png'));

const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 운영 의존성만(lockfile 그대로). 설치 스크립트는 돌리지 않는다.
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
rmSync(join(stage, 'package-lock.json'), { force: true });

const mcpb = join(root, 'node_modules', '.bin', isWindows ? 'mcpb.cmd' : 'mcpb');
if (!existsSync(mcpb)) throw new Error('mcpb CLI 가 없습니다. npm ci 로 devDependencies(@anthropic-ai/mcpb)를 설치하세요.');
run(mcpb, ['validate', join(stage, 'manifest.json')]);
run(mcpb, ['pack', stage, output]);

const bytes = readFileSync(output);
const sha256 = createHash('sha256').update(bytes).digest('hex');
process.stdout.write(`\n[build-mcpb] ${output}\n[build-mcpb] version ${pkg.version}, ${statSync(output).size} bytes, sha256 ${sha256}\n`);
