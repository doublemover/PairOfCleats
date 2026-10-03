#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot } from '../../../../src/shared/repo-paths.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { runNode } from '../../../helpers/run-node.js';

if (process.platform === 'win32') {
  console.log('embedding CLI signal injection skipped on Windows: POSIX termination signals required');
  process.exit(0);
}

const root = process.cwd();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('embedding-cli-signal-failure', { clean: true });
const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });
const sourcePath = path.join(repoRoot, 'alpha.js');
await fs.writeFile(sourcePath, 'export const alpha = 1;\n');
const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'stub',
  testConfig: {
    threads: 1,
    sqlite: { use: false },
    indexing: {
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      scm: { provider: 'none' },
      embeddings: { enabled: true, mode: 'inline', hnsw: { enabled: false }, lancedb: { enabled: false } }
    },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  }
});
const args = [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'code', '--threads', '1', '--progress', 'off'];
runNode([...args, '--stage', 'stage2'], 'seed previous current build', root, env, { stdio: 'pipe', timeoutMs: 15000 });
const currentPath = path.join(getRepoCacheRoot(repoRoot), 'builds', 'current.json');
const previousCurrent = await fs.readFile(currentPath, 'utf8');

for (const [index, signal] of ['SIGTERM', 'SIGKILL'].entries()) {
  await fs.writeFile(sourcePath, `export const alpha = ${index + 2};\n`);
  const injector = path.join(tempRoot, `inject-${signal}.mjs`);
  await fs.writeFile(injector, [
    "import childProcess from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const originalSpawn = childProcess.spawn;',
    'childProcess.spawn = function(command, args, options) {',
    '  const child = originalSpawn.call(this, command, args, options);',
    "  if (args?.some((arg) => /embeddings\\.js$/.test(String(arg)) || arg === 'build-embeddings')) {",
    `    process.stderr.write('Injected ${signal} into embeddings child\\n');`,
    `    child.kill('${signal}');`,
    '  }',
    '  return child;',
    '};',
    'syncBuiltinESMExports();'
  ].join('\n'));
  const result = runNode(['--import', injector, ...args], `inject ${signal}`, root, env, {
    stdio: 'pipe',
    timeoutMs: 15000,
    allowFailure: true
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.error, undefined, 'fault injection must finish before its timeout');
  assert.notEqual(result.status, 0, 'unexpected child termination must fail the CLI');
  assert.match(output, new RegExp(`terminated by signal ${signal}`));
  assert.equal(output.includes('[DONE]'), false, 'failed build must not report success');
  assert.equal(await fs.readFile(currentPath, 'utf8'), previousCurrent, 'failed embeddings must not promote over the previous build');
}

console.log('embedding CLI unexpected-signal failure/promotion test passed');
