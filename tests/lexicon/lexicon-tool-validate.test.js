#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'lexicon', 'validate.js');
const schemaPath = path.join(root, 'src', 'lang', 'lexicon', 'language-lexicon-wordlist.schema.json');

const ok = spawnSync(process.execPath, [scriptPath, '--json'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(ok.status, 0, `expected validate script success: ${ok.stderr || ok.stdout}`);
const okPayload = JSON.parse(ok.stdout || '{}');
assert.equal(okPayload.ok, true, 'expected validate payload ok=true');
assert.ok(okPayload.counts?.filesScanned >= 1, 'expected at least one lexicon file');

const tempRoot = path.join(root, '.testCache', 'lexicon-tool-validate');
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

const bad = spawnSync(process.execPath, [scriptPath, '--json', '--dir', tempRoot, '--schema', schemaPath], {
  cwd: root,
  encoding: 'utf8'
});
assert.notEqual(bad.status, 0, 'expected invalid lexicon validation to fail');
const badPayload = JSON.parse(bad.stdout || '{}');
assert.equal(badPayload.ok, false, 'expected bad validation payload ok=false');
assert.ok(Array.isArray(badPayload.errors) && badPayload.errors.length > 0, 'expected validation errors');

console.log('lexicon tool validate test passed');
