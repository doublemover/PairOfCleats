#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'setup-readiness-exit');
const repo = path.join(tempRoot, 'repo');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repo, { recursive: true });
const shim = path.join(tempRoot, 'controlled-download.mjs');
await fs.writeFile(shim, [
  "import childProcess from 'node:child_process';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const original = childProcess.spawnSync;',
  'childProcess.spawnSync = function(command, args, options) {',
  "  if (args.some((arg) => /tools[\\\\/]download[\\\\/]dicts\\.js$/.test(String(arg)))) {",
  "    return { status: 1, signal: null, pid: null, stdout: Buffer.from(''), stderr: Buffer.from('controlled dictionary failure') };",
  '  }',
  '  return original(command, args, options);',
  '};',
  'syncBuiltinESMExports();'
].join('\n'));
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(tempRoot, 'cache'),
  extraEnv: { PAIROFCLEATS_DICT_DIR: path.join(tempRoot, 'dictionary') } });
const baseArgs = [path.join(root, 'tools/setup/setup.js'), '--root', repo, '--non-interactive',
  '--skip-install', '--skip-validate', '--skip-models', '--skip-extensions', '--skip-tooling',
  '--skip-index', '--skip-sqlite', '--skip-artifacts', '--json'];
const run = (extra, inject = false) => {
  const result = runNode([...(inject ? ['--import', shim] : []), ...baseArgs, ...extra],
    'setup readiness fixture', root, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  return { result, payload: JSON.parse(result.stdout) };
};
const optional = run([], true);
assert.equal(optional.result.status, 0);
assert.equal(optional.payload.readiness.state, 'degraded');
assert.deepEqual(optional.payload.readiness.omittedIds, ['dictionaries']);
assert.equal(optional.payload.errors[0].step, 'dictionaries');
assert.doesNotMatch(optional.result.stderr, /Setup complete\./);
const required = run(['--require-steps', 'dictionaries'], true);
assert.equal(required.result.status, 1);
assert.equal(required.payload.readiness.state, 'blocked');
assert.deepEqual(required.payload.readiness.blockedIds, ['dictionaries']);
const skipped = run(['--skip-dicts', '--require-steps', 'tooling']);
assert.equal(skipped.result.status, 1);
assert.deepEqual(skipped.payload.readiness.blockedIds, ['tooling']);
assert.equal(skipped.payload.readiness.items.find((item) => item.id === 'tooling').state, 'skipped');
const complete = run(['--skip-dicts']);
assert.equal(complete.result.status, 0);
assert.equal(complete.payload.readiness.state, 'ready');
assert.match(complete.result.stderr, /Setup complete\./);
console.log('Setup retains optional failure, blocks required/skipped prerequisites, and keeps skip-all behavior explicit.');
