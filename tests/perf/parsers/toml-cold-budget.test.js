#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseTomlStructure } from '../../../src/shared/toml-structure.js';
import { quotedToml } from '../../fixtures/formats/toml-quoted.js';

const model = parseTomlStructure(quotedToml);
const receipt = { sourceSha256: createHash('sha256').update(quotedToml).digest('hex'),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  reason: model.reason, metrics: model.metrics, initialization: parseTomlStructure.initialize() };
console.log(JSON.stringify(receipt));
assert.equal(model.reason, null, 'fresh-process production parsing must admit the unchanged quoted/date/integer corpus');
assert.equal(model.metrics.localLimitMs, 30);
assert.ok(model.metrics.elapsedMs < 30, 'preserve the real production parsing deadline');
assert.deepEqual(model.importEntries.map(entry => entry.value),
  ['escaped.toml', 'dotted.toml', 'unicode.toml', '../quoted']);
assert.deepEqual(model.headings.map(entry => entry.path), [['tool.poc', '😀'], ['dependencies', 'quoted.crate']]);
console.log('serial cold TOML production budget and semantic witnesses passed');
