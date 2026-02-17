#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'lexicon', 'report.js');

const result = spawnSync(process.execPath, [scriptPath, '--json'], {
  cwd: root,
  encoding: 'utf8'
});

assert.equal(result.status, 0, `expected report script success: ${result.stderr || result.stdout}`);
const payload = JSON.parse(result.stdout || '{}');
assert.ok(Array.isArray(payload.wordlists), 'expected wordlists array');
assert.ok(payload.wordlists.length >= 1, 'expected at least one wordlist');
assert.equal(payload.versioning?.wordlistFormatVersion, 1, 'expected report wordlist format version 1');
assert.equal(payload.versioning?.explainPayloadVersion, 1, 'expected explain payload version 1');
assert.equal(payload.versioning?.nonAsciiSupport, 'deferred-v2', 'expected non-ascii v2 deferral marker');
const hasGeneric = payload.wordlists.some((entry) => entry.languageId === '_generic');
assert.equal(hasGeneric, true, 'expected generic fallback lexicon in report');

console.log('lexicon report test passed');
