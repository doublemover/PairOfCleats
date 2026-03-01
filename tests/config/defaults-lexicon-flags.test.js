#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizePostingsConfig } from '../../src/shared/postings-config.js';
import { loadConfigSchema } from '../helpers/config-schema.js';

const schema = await loadConfigSchema();

const indexingLexiconEnabled = schema?.properties?.indexing?.properties?.lexicon?.properties?.enabled?.default;
const postingsChargramFields = schema?.properties?.indexing?.properties?.postings?.properties?.chargramFields?.default;
const postingsChargramStopwords = schema?.properties?.indexing?.properties?.postings?.properties?.chargramStopwords?.default;
const annCandidateCap = schema?.properties?.retrieval?.properties?.annCandidateCap?.default;
const annCandidateMinDocCount = schema?.properties?.retrieval?.properties?.annCandidateMinDocCount?.default;
const annCandidateMaxDocCount = schema?.properties?.retrieval?.properties?.annCandidateMaxDocCount?.default;
const relationBoostEnabled = schema?.properties?.retrieval?.properties?.relationBoost?.properties?.enabled?.default;

assert.equal(indexingLexiconEnabled, true, 'expected indexing.lexicon.enabled default true');
assert.deepEqual(postingsChargramFields, ['name', 'doc'], 'expected chargram field defaults');
assert.equal(postingsChargramStopwords, false, 'expected chargram stopwords default false');
assert.equal(annCandidateCap, 20000, 'expected ann candidate cap default');
assert.equal(annCandidateMinDocCount, 100, 'expected ann candidate min doc count default');
assert.equal(annCandidateMaxDocCount, 20000, 'expected ann candidate max doc count default');
assert.equal(relationBoostEnabled, false, 'expected relation boost default disabled');

const postingsDefaults = normalizePostingsConfig({});
assert.deepEqual(postingsDefaults.chargramFields, ['name', 'doc'], 'normalized postings defaults changed');
assert.equal(postingsDefaults.chargramStopwords, false, 'normalized chargram stopwords default changed');

console.log('config defaults lexicon flags test passed');
