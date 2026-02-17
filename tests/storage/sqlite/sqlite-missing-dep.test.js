#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-missing-dep');
const cacheRoot = path.join(tempRoot, '.cache');
const searchPath = path.join(root, 'search.js');
const buildIndexPath = path.join(root, 'build_index.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const sampleCode = `
export function greet(name) {
  return "hello " + name;
}
`;
await fsPromises.writeFile(path.join(tempRoot, 'sample.js'), sampleCode);

const envBase = {
  ...process.env,  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
applyTestEnv();
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const run = (args, label, envOverride = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: tempRoot,
    env: { ...envBase, ...envOverride },
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run([buildIndexPath, '--stub-embeddings', '--repo', tempRoot], 'build index');
await runSqliteBuild(tempRoot);

const autoOutput = run(
  [searchPath, 'greet', '--json', '--repo', tempRoot],
  'search auto with sqlite disabled',
  { NODE_OPTIONS: '--no-addons' }
);
let autoBackend = null;
try {
  autoBackend = JSON.parse(autoOutput).backend;
} catch {
  console.error('Failed to parse JSON output for auto sqlite fallback.');
  process.exit(1);
}
if (autoBackend !== 'memory') {
  console.error(`Expected memory backend with sqlite disabled, got ${autoBackend}`);
  process.exit(1);
}

const forcedResult = spawnSync(
  process.execPath,
  [searchPath, 'greet', '--json', '--backend', 'sqlite', '--repo', tempRoot],
  {
    cwd: tempRoot,
    env: { ...envBase, NODE_OPTIONS: '--no-addons' },
    encoding: 'utf8'
  }
);
if (forcedResult.status === 0) {
  console.error('Expected forced sqlite search to fail when sqlite is disabled.');
  process.exit(1);
}
const forcedOutput = String(forcedResult.stdout || '').trim();
const forcedStderr = String(forcedResult.stderr || '').trim();
let forcedMessage = '';
try {
  forcedMessage = JSON.parse(forcedOutput)?.message || '';
} catch {
  forcedMessage = forcedStderr;
}
if (!forcedMessage.includes('better-sqlite3 is required')) {
  console.error('Expected missing dependency message for forced sqlite backend.');
  if (forcedOutput) console.error(forcedOutput);
  if (forcedStderr) console.error(forcedStderr);
  process.exit(1);
}

console.log('SQLite missing dependency test passed');

