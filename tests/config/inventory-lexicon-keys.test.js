#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const inventoryPath = path.join(root, 'docs', 'config', 'inventory.json');
const payload = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
const keySet = new Set((payload.configKeys || []).map((entry) => entry.path));

const requiredKeys = [
  'indexing.lexicon.enabled',
  'indexing.postings.chargramFields',
  'indexing.postings.chargramStopwords',
  'retrieval.annCandidateCap',
  'retrieval.annCandidateMinDocCount',
  'retrieval.annCandidateMaxDocCount',
  'retrieval.relationBoost.enabled',
  'retrieval.relationBoost.perCall',
  'retrieval.relationBoost.perUse',
  'retrieval.relationBoost.maxBoost'
];

for (const key of requiredKeys) {
  assert.ok(keySet.has(key), `missing config inventory key: ${key}`);
}

console.log('config inventory lexicon keys test passed');
