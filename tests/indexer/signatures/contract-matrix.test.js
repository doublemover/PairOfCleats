#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { buildIndexSignature, INDEX_SIGNATURE_TTL_MS } from '../../../src/retrieval/index-cache.js';
import { buildIncrementalSignature, buildTokenizationKey } from '../../../src/index/build/indexer/signatures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(process.cwd(), 'indexer-signatures-contract-matrix');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const indexStatePath = path.join(tempRoot, 'index_state.json');
const chunkMetaPath = path.join(tempRoot, 'chunk_meta.json');
const tokenPostingsPath = path.join(tempRoot, 'token_postings.json');
const fileRelationsPath = path.join(tempRoot, 'file_relations.json');

await fsPromises.writeFile(
  indexStatePath,
  JSON.stringify({ buildId: 'buildA', mode: 'code', artifactSurfaceVersion: '1' })
);
const signatureA = await buildIndexSignature(tempRoot);
assert.ok(signatureA);

const syncMethods = ['readFileSync', 'statSync', 'readdirSync', 'existsSync'];
const syncOriginals = new Map();
for (const name of syncMethods) {
  syncOriginals.set(name, fsSync[name]);
  fsSync[name] = () => {
    throw new Error(`sync fs used: ${name}`);
  };
}

let signatureB;
try {
  await fsPromises.writeFile(
    indexStatePath,
    JSON.stringify({ buildId: 'buildB', mode: 'code', artifactSurfaceVersion: '1' })
  );
  signatureB = await buildIndexSignature(tempRoot);
} finally {
  for (const [name, original] of syncOriginals.entries()) {
    fsSync[name] = original;
  }
}
assert.notEqual(signatureA, signatureB);

await fsPromises.rm(indexStatePath, { force: true });
await fsPromises.writeFile(chunkMetaPath, JSON.stringify([{ id: 0, file: 'a.js' }]));
await fsPromises.writeFile(tokenPostingsPath, JSON.stringify({ vocab: [], postings: [], docLengths: [] }));
await fsPromises.writeFile(fileRelationsPath, JSON.stringify([{ file: 'a.js', imports: ['b.js'] }]));

const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
let signatureC;
let signatureD;
try {
  signatureC = await buildIndexSignature(tempRoot);
  await fsPromises.writeFile(
    chunkMetaPath,
    JSON.stringify([{ id: 0, file: 'a.js' }, { id: 1, file: 'b.js' }])
  );
  now += INDEX_SIGNATURE_TTL_MS + 1;
  signatureD = await buildIndexSignature(tempRoot);
} finally {
  Date.now = originalNow;
}
assert.notEqual(signatureC, signatureD);

const baseRuntime = {
  commentsConfig: {
    licensePattern: /MIT/,
    generatedPattern: /@generated/,
    linterPattern: /eslint/
  },
  dictConfig: { splitCase: true },
  postingsConfig: { enablePhraseNgrams: true },
  dictSignature: 'sig-a',
  segmentsConfig: { enabled: true }
};

const tokenKeyA = buildTokenizationKey(baseRuntime, 'code');
const tokenKeyB = buildTokenizationKey({ ...baseRuntime, dictSignature: 'sig-b' }, 'code');
assert.notEqual(tokenKeyA, tokenKeyB);

const runtimeA = {
  astDataflowEnabled: true,
  controlFlowEnabled: false,
  lintEnabled: true,
  complexityEnabled: true,
  riskAnalysisEnabled: false,
  riskAnalysisCrossFileEnabled: false,
  typeInferenceEnabled: true,
  typeInferenceCrossFileEnabled: false,
  gitBlameEnabled: true,
  indexingConfig: {
    riskRules: { foo: 'bar' },
    riskCaps: { max: 1 },
    importScan: 'post'
  },
  languageOptions: {
    javascript: { parser: 'babel', flow: 'auto' },
    typescript: { parser: 'auto', importsOnly: false },
    treeSitter: {
      enabled: true,
      languages: { js: true },
      configChunking: true,
      maxBytes: 100,
      maxLines: 200,
      maxParseMs: 300,
      byLanguage: {}
    },
    yamlChunking: { mode: 'root' },
    kotlin: { flowMaxBytes: 1 }
  },
  embeddingEnabled: true,
  embeddingService: false,
  embeddingMode: 'inline',
  embeddingBatchSize: 32,
  profile: { id: 'default', schemaVersion: 1 },
  toolInfo: { version: '1.0.0' },
  fileCaps: { default: { maxBytes: 1, maxLines: 2 }, byExt: {}, byLanguage: {} },
  fileScan: { sampleBytes: 64 },
  incrementalBundleFormat: 'json'
};

const sigA = buildIncrementalSignature(runtimeA, 'code', tokenKeyA);
assert.notEqual(sigA, buildIncrementalSignature({
  ...runtimeA,
  languageOptions: {
    ...runtimeA.languageOptions,
    typescript: { parser: 'typescript', importsOnly: false }
  }
}, 'code', tokenKeyA));
assert.notEqual(sigA, buildIncrementalSignature({ ...runtimeA, embeddingBatchSize: 64 }, 'code', tokenKeyA));
assert.notEqual(sigA, buildIncrementalSignature({ ...runtimeA, toolInfo: { version: '1.0.1' } }, 'code', tokenKeyA));
assert.notEqual(sigA, buildIncrementalSignature({ ...runtimeA, profile: { id: 'vector_only', schemaVersion: 1 } }, 'code', tokenKeyA));

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('indexer signatures contract matrix test passed');
