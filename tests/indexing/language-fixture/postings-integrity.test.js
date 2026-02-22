#!/usr/bin/env node
import { loadTokenPostings } from '../../../src/shared/artifact-io.js';
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
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

let tokenPostings = null;
try {
  tokenPostings = loadTokenPostings(codeDir, { strict: true });
} catch (err) {
  console.error(`Token postings check failed: ${err?.message || err}`);
  process.exit(1);
}
validateTokenPostings(tokenPostings, 'token_postings');

console.log('Language fixture token postings integrity ok.');
