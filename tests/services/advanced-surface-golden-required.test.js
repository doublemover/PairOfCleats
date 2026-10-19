#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { runNode } from '../helpers/run-node.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('advanced-surface-golden-required', { root, clean: true });
const hook = path.join(dir, 'missing-golden.mjs');
await fs.writeFile(hook, `
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  const exists = fs.existsSync;
  fs.existsSync = file => String(file).replaceAll('\\\\', '/').endsWith('/tests/services/golden/advanced-surface-goldens.json')
    ? false : exists(file);
  syncBuiltinESMExports();
`);
try {
  const result = runNode(['--import', pathToFileURL(hook).href, path.join(root, 'tests/services/advanced-surface-goldens.test.js')],
    'missing advanced-surface baseline', root, applyTestEnv({ syncProcess: false }), {
      stdio: 'pipe', allowFailure: true, timeoutMs: 10000
    });
  assert.equal(result.error, undefined, 'missing baseline must fail before expensive index setup');
  assert.equal(result.status, 1, `${result.stdout || ''}\n${result.stderr || ''}`);
  assert.match(result.stderr || '', /Missing checked-in advanced-surface golden baseline/);
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Advanced-surface golden baseline is required before indexing.');
