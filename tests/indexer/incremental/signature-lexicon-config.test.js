#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildIncrementalSignature, buildTokenizationKey } from '../../../src/index/build/indexer/signatures.js';

const baseRuntime = {
  commentsConfig: {
    licensePattern: /MIT/,
    generatedPattern: /@generated/,
    linterPattern: /eslint/
  },
  dictConfig: { splitCase: true },
  postingsConfig: { enablePhraseNgrams: true },
  dictSignature: 'lexicon-sig',
  segmentsConfig: { enabled: true },
  indexingConfig: {},
  languageOptions: {
    javascript: { parser: 'babel', flow: 'auto' },
    typescript: { parser: 'auto', importsOnly: false },
    lexicon: { enabled: true }
  },
  toolInfo: { version: '1.0.0' },
  profile: { id: 'default', schemaVersion: 1 }
};

const tokenizationKey = buildTokenizationKey(baseRuntime, 'code');
const sigEnabled = buildIncrementalSignature(baseRuntime, 'code', tokenizationKey);
const sigDisabled = buildIncrementalSignature({
  ...baseRuntime,
  languageOptions: {
    ...baseRuntime.languageOptions,
    lexicon: { enabled: false }
  }
}, 'code', tokenizationKey);

assert.notEqual(sigEnabled, sigDisabled, 'expected lexicon config change to invalidate signature');
console.log('signature lexicon config test passed');
