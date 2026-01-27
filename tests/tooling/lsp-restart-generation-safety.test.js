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

const client = createLspClient({
  cmd: process.execPath,
  args: [serverPath],
  env: { ...process.env, POC_LSP_COUNTER: counterPath },
  log: () => {}
});

client.start();
await new Promise((resolve) => setTimeout(resolve, 50));
client.kill();
client.start();
await new Promise((resolve) => setTimeout(resolve, 100));

await client.initialize({ rootUri: pathToFileURL(tempRoot).href });
await client.shutdownAndExit();
await new Promise((resolve) => setTimeout(resolve, 100));
client.kill();

const counterRaw = await fs.readFile(counterPath, 'utf8');
const spawns = counterRaw.trim().split(/\r?\n/).filter(Boolean).length;
assert.equal(spawns, 2, 'expected only two LSP spawns after restart');

console.log('LSP generation safety test passed');
