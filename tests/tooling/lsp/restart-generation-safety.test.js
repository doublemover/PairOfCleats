#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess.js';
import { sleep } from '../../../src/shared/sleep.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-generation');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const counterPath = path.join(tempRoot, 'spawn-counter.txt');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const countSpawns = async () => countNonEmptyLines(counterPath);

const waitForSpawns = async (expected, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await countSpawns() >= expected) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${expected} LSP spawn(s).`);
};

const client = createLspClient({
  cmd: process.execPath,
  args: [serverPath],
  env: { ...process.env, POC_LSP_COUNTER: counterPath },
  log: () => {}
});

try {
  client.start();
  await waitForSpawns(1);
  client.kill();
  client.start();
  await waitForSpawns(2);

  await client.initialize({ rootUri: pathToFileURL(tempRoot).href });
  await client.shutdownAndExit();
  await sleep(100);
} finally {
  client.kill();
}

await sleep(200);
assert.equal(
  getTrackedSubprocessCount(),
  0,
  'expected tracked subprocess registry to be empty after restart/kill sequence'
);

const spawns = await countSpawns();
assert.equal(spawns, 2, 'expected only two LSP spawns after restart');

console.log('LSP generation safety test passed');
