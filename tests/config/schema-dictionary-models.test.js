#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateConfig } from '../../src/config/validate.js';
import { loadConfigSchema } from '../helpers/config-schema.js';

const schema = await loadConfigSchema();
const valid = {
  dictionary: {
    dir: 'C:/approved-task/actual-dictionaries',
    languages: ['en'], files: [], includeSlang: false,
    slangDirs: [], slangFiles: [], enableRepoDictionary: true,
    segmentation: 'auto', dpMaxTokenLength: 32,
    dpMaxTokenLengthByFileCount: [{ maxFiles: 1000, dpMaxTokenLength: 16 }]
  },
  models: { id: 'Xenova/all-MiniLM-L12-v2', dir: 'C:/approved-task/models' },
  indexing: { codeDictLanguages: [] }
};
assert.deepEqual(validateConfig(schema, valid), { ok: true, errors: [] });
for (const segmentation of ['auto', 'dp', 'greedy', 'aho']) {
  assert.equal(validateConfig(schema, { dictionary: { segmentation } }).ok, true);
}
for (const invalid of [
  { dictionary: { unknown: true } },
  { models: { unknown: true } },
  { dictionary: { languages: [1] } },
  { dictionary: { files: [''] } },
  { dictionary: { dir: 1 } },
  { dictionary: { enableRepoDictionary: 'yes' } },
  { dictionary: { segmentation: 'unknown' } },
  { dictionary: { dpMaxTokenLength: 0 } },
  { dictionary: { dpMaxTokenLength: Infinity } },
  { dictionary: { dpMaxTokenLengthByFileCount: [{ maxFiles: -1, dpMaxTokenLength: 4 }] } },
  { dictionary: { dpMaxTokenLengthByFileCount: [{ maxFiles: 1 }] } },
  { dictionary: { dpMaxTokenLengthByFileCount: [{ maxFiles: 1, dpMaxTokenLength: 4, extra: 1 }] } },
  { models: { id: '' } },
  { models: { dir: [] } }
]) {
  assert.equal(validateConfig(schema, invalid).ok, false, JSON.stringify(invalid));
}
console.log('config dictionary and model schema test passed');
