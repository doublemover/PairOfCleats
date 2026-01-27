#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../../src/integrations/tooling/lsp/client.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lsp-generation');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const counterPath = path.join(tempRoot, 'spawn-counter.txt');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const countSpawns = async () => {
  try {
    const counterRaw = await fs.readFile(counterPath, 'utf8');
    return counterRaw.trim().split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
};

const waitForSpawns = async (expected, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await countSpawns() >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${expected} LSP spawn(s).`);
};

const client = createLspClient({
  cmd: process.execPath,
  args: [serverPath],
  env: { ...process.env, POC_LSP_COUNTER: counterPath },
  log: () => {}
});

client.start();
await waitForSpawns(1);
client.kill();
client.start();
await waitForSpawns(2);

await client.initialize({ rootUri: pathToFileURL(tempRoot).href });
await client.shutdownAndExit();
await new Promise((resolve) => setTimeout(resolve, 100));
client.kill();

const spawns = await countSpawns();
assert.equal(spawns, 2, 'expected only two LSP spawns after restart');

console.log('LSP generation safety test passed');
