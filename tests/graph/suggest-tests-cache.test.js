#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-tests-cache-'));
const srcDir = path.join(repoRoot, 'src');
const testsDir = path.join(repoRoot, 'tests');
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(testsDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'app.js'), 'export const app = 1;');
fs.writeFileSync(path.join(testsDir, 'app.test.js'), 'test("app", () => {});');

const build = () => buildSuggestTestsReport({
  changed: ['src/app.js'],
  repoRoot,
  graphRelations: null,
  indexSignature: 'test',
  now: () => '2026-02-04T00:00:00.000Z'
});

const first = build();
fs.writeFileSync(path.join(testsDir, 'other.test.js'), 'test("other", () => {});');
const second = build();

assert.strictEqual(first.suggestions.length, 1);
assert.strictEqual(second.suggestions.length, 1);
assert.strictEqual(second.suggestions[0].testPath, first.suggestions[0].testPath);

console.log('suggest tests cache test passed');
