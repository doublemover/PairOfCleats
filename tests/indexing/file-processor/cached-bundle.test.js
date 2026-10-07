#!/usr/bin/env node

import {
  createCachedBundleFixturePayload,
  createCachedBundleTestFixture,
  reuseCachedBundleForTest
} from './file-processor-fixture.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const cachedBundle = createCachedBundleFixturePayload({
  chunk: {
    codeRelations: {
      imports: ['dep'],
      exports: ['demo'],
      calls: [['demo', 'dep']]
    }
  },
  fileRelations: {
    importLinks: ['dep.js']
  }
});
const fixture = await createCachedBundleTestFixture('file-processor-cached', { cachedBundle });

const { result, skip } = reuseCachedBundleForTest(fixture);

if (skip) {
  fail('Expected cached bundle to be reused without skip.');
}
if (!result) {
  fail('Expected cached bundle reuse result.');
}
const importLinks = Array.isArray(result.fileRelations?.importLinks)
  ? result.fileRelations.importLinks
  : [];
if (importLinks.length !== 1 || importLinks[0] !== 'dep.js') {
  fail('Expected importLinks to be preserved from cached file relations.');
}
const chunk = result.chunks[0];
if (!chunk?.metaV2?.chunkId) {
  fail('Expected cached chunk to have metaV2 chunkId.');
}
if (chunk?.metaV2?.fileHash !== 'hash' || chunk?.metaV2?.fileHashAlgo !== 'sha1') {
  fail('Expected cached chunk to include file hash metadata.');
}
if (!Array.isArray(chunk?.codeRelations?.calls)) {
  fail('Expected cached chunk to preserve non-file relation fields.');
}
if (!result.fileMetrics?.cached) {
  fail('Expected cached file metrics to set cached=true.');
}

const missingRelations = {
  chunks: cachedBundle.chunks.slice()
};
const missingResult = reuseCachedBundleForTest({
  ...fixture,
  cachedBundle: missingRelations,
});
if (missingResult?.result) {
  fail('Expected cached bundle without fileRelations to skip reuse.');
}

const algoResult = reuseCachedBundleForTest({
  ...fixture,
  fileHashAlgo: 'xxh64',
  fileHash: 'hash-xx',
  manifestFile: { bundle: 'cached.json', hash: 'hash-xx', hashAlgo: 'xxh64' }
});
if (!algoResult?.result?.fileInfo || algoResult.result.fileInfo.hashAlgo !== 'xxh64') {
  fail('Expected cached bundle to preserve file hash algorithm.');
}
if (algoResult.result.chunks[0]?.fileHashAlgo !== 'xxh64') {
  fail('Expected cached chunk to preserve file hash algorithm.');
}

console.log('file processor cached bundle tests passed');

