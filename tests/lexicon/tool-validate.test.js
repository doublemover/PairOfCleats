#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runNode } from '../helpers/run-node.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'lexicon', 'validate.js');
const schemaPath = path.join(root, 'src', 'lang', 'lexicon', 'language-lexicon-wordlist.schema.json');
const env = applyTestEnv({ syncProcess: false });

const ok = runNode([scriptPath, '--json'], 'lexicon validate json', root, env, {
  stdio: 'pipe'
});
assert.equal(ok.status, 0, `expected validate script success: ${ok.stderr || ok.stdout}`);
const okPayload = JSON.parse(ok.stdout || '{}');
assert.equal(okPayload.ok, true, 'expected validate payload ok=true');
assert.ok(okPayload.counts?.filesScanned >= 1, 'expected at least one lexicon file');

const tempRoot = resolveTestCachePath(root, 'lexicon-tool-validate');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'badlang.json'),
  JSON.stringify({
    formatVersion: 1,
    languageId: 'badlang',
    keywords: ['If'],
    literals: ['null']
  }, null, 2)
);

const bad = runNode(
  [scriptPath, '--json', '--dir', tempRoot, '--schema', schemaPath],
  'lexicon validate invalid wordlist',
  root,
  env,
  {
    stdio: 'pipe',
    allowFailure: true
  }
);
assert.notEqual(bad.status, 0, 'expected invalid lexicon validation to fail');
const badPayload = JSON.parse(bad.stdout || '{}');
assert.equal(badPayload.ok, false, 'expected bad validation payload ok=false');
assert.ok(Array.isArray(badPayload.errors) && badPayload.errors.length > 0, 'expected validation errors');

console.log('lexicon tool validate test passed');
