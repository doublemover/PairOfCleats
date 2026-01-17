#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});
const { codeDir } = loadFixtureIndexMeta(fixtureRoot, userConfig);

const extractPostings = (payload) => {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.postings)) return payload.postings;
  if (Array.isArray(payload.arrays?.postings)) return payload.arrays.postings;
  return [];
};

const validateTokenPostings = (payload, label) => {
  const postings = extractPostings(payload);
  for (let i = 0; i < postings.length; i += 1) {
    const list = postings[i];
    if (!Array.isArray(list)) continue;
    for (let j = 0; j < list.length; j += 1) {
      const entry = list[j];
      if (!Array.isArray(entry)) continue;
      const count = entry[1];
      if (!Number.isInteger(count)) {
        console.error(`Token postings contain non-integer counts (${label}) at ${i}/${j}: ${count}`);
        process.exit(1);
      }
    }
  }
};

const tokenPostingsPath = path.join(codeDir, 'token_postings.json');
const tokenPostingsMetaPath = path.join(codeDir, 'token_postings.meta.json');

if (fs.existsSync(tokenPostingsPath)) {
  const tokenPostings = JSON.parse(fs.readFileSync(tokenPostingsPath, 'utf8'));
  validateTokenPostings(tokenPostings, 'token_postings.json');
} else if (fs.existsSync(tokenPostingsMetaPath)) {
  const tokenMeta = JSON.parse(fs.readFileSync(tokenPostingsMetaPath, 'utf8'));
  const parts = Array.isArray(tokenMeta?.fields?.parts) ? tokenMeta.fields.parts : [];
  if (!parts.length) {
    console.error('Token postings check failed: sharded metadata missing parts list.');
    process.exit(1);
  }
  for (const part of parts) {
    const partPath = path.join(codeDir, part);
    if (!fs.existsSync(partPath)) {
      console.error(`Token postings shard missing: ${partPath}`);
      process.exit(1);
    }
    const shard = JSON.parse(fs.readFileSync(partPath, 'utf8'));
    validateTokenPostings(shard, part);
  }
} else {
  console.error('Token postings check failed: postings metadata not found.');
  process.exit(1);
}

console.log('Language fixture token postings integrity ok.');
