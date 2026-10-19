import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { formatCommandFailure } from '../../helpers/command-failure.js';
const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-bench-runtime-boundary-'));
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(temp, 'cache'), embeddings: 'off' });
try {
  const runtimeGuardPath = path.join(temp, 'guard-bench-runtime.mjs');
  const guardedModules = [
    'src/integrations/core/index.js',
    'tools/bench/micro/index-build.js',
    'tools/bench/micro/search.js'
  ].map((relativePath) => pathToFileURL(path.join(root, relativePath)).href);
  await fs.writeFile(runtimeGuardPath, `
import { registerHooks } from 'node:module';
const guardedModules = new Set(${JSON.stringify(guardedModules)});
registerHooks({
  load(url, context, nextLoad) {
    if (guardedModules.has(url)) throw new Error('BENCH_WORKFLOW_RUNTIME_LOADED');
    return nextLoad(url, context);
  }
});
`);
  const guardedEnv = {
    ...env,
    NODE_OPTIONS: [env.NODE_OPTIONS, `--import=${pathToFileURL(runtimeGuardPath).href}`].filter(Boolean).join(' ')
  };
  for (const entrypoint of [
    [path.join(root, 'bin', 'pairofcleats.js'), 'bench', 'micro'],
    [path.join(root, 'tools', 'bench', 'micro', 'run.js')]
  ]) {
    const guardedRun = (args) => runNode([...entrypoint, ...args], 'bench parser runtime boundary', temp,
      guardedEnv, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    const invalid = guardedRun(['--poc-unknown-option']);
    assert.equal(invalid.status, 1, formatCommandFailure({ label: 'invalid bench options', result: invalid }));
    assert.match(invalid.stderr, /Unknown argument: poc-unknown-option/);
    assert.doesNotMatch(invalid.stderr + invalid.stdout, /BENCH_WORKFLOW_RUNTIME_LOADED/);
    const help = guardedRun(['--help']);
    assert.equal(help.status, 0, formatCommandFailure({ label: 'bench help', result: help }));
    assert.match(help.stdout, /--components/);
    assert.doesNotMatch(help.stderr + help.stdout, /BENCH_WORKFLOW_RUNTIME_LOADED/);
    const valid = guardedRun(['--no-build', '--components=', '--json']);
    assert.equal(valid.status, 1, formatCommandFailure({ label: 'bench runtime guard control', result: valid }));
    assert.match(valid.stderr, /BENCH_WORKFLOW_RUNTIME_LOADED/, 'valid options must reach the guarded runtime');
    assert.doesNotMatch(valid.stderr, /Unknown argument/);
  }

  await assert.rejects(fs.access(path.join(temp, 'cache')), 'parser-only calls cannot create a cache');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
console.log('Bench parser/runtime boundary passed');
