#!/usr/bin/env node
import { finalizeMetaV2 } from '../../../src/index/metadata-v2.js';

import {
  createCachedBundleTestFixture,
  reuseCachedBundleForTest
} from './file-processor-fixture.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const fixture = await createCachedBundleTestFixture('cached-bundle-metav2');
const { result, skip } = reuseCachedBundleForTest(fixture);

if (skip || !result?.chunks?.length) {
  fail('Expected cached bundle reuse to succeed.');
}

const chunk = result.chunks[0];
if (chunk.metaV2?.types?.inferred?.returns) {
  fail('Expected cached bundle metaV2 to not include inferred returns before enrichment.');
}

chunk.docmeta = {
  ...chunk.docmeta,
  inferredTypes: {
    returns: [{ type: 'Widget', source: 'flow', confidence: 0.7 }]
  }
};

finalizeMetaV2({
  chunks: result.chunks,
  toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' },
  analysisPolicy: { metadata: { enabled: true } }
});

const inferred = chunk.metaV2?.types?.inferred?.returns || [];
if (!inferred.some((entry) => entry.type === 'Widget' && entry.source === 'flow')) {
  fail('Expected finalized metaV2 to include post-enrichment inferred return types.');
}

console.log('cached bundle metaV2 finalization test passed');
