#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseJsoncText } from '../../../src/shared/jsonc.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const { dir: tempRoot } = await prepareTestCacheDir('generate-demo-config-output', { root });
const scriptPath = path.join(root, 'tools', 'config', 'generate-demo-config.js');
const outPath = path.join(tempRoot, 'nested', 'demo.pairofcleats.json');
const env = applyTestEnv({ syncProcess: false });

const result = runNode(
  [scriptPath, '--out', outPath],
  'generate demo config output',
  root,
  env,
  { stdio: 'pipe', timeoutMs: 30_000 }
);

const output = await fs.readFile(outPath, 'utf8');
const parsed = parseJsoncText(output, outPath);
assert.equal(typeof parsed, 'object', 'expected generated demo config to parse as an object');
assert.ok(parsed.indexing, 'expected generated demo config to include indexing config');
assert.ok(result.stderr.includes(`Wrote ${outPath}`), 'expected write summary on stderr');

console.log('generate demo config output test passed');
