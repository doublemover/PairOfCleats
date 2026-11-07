import assert from 'node:assert/strict';
import { discoverSegments, normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { buildCdcSegments, CDC_SEGMENTATION_VERSION } from '../../../src/index/segments/cdc.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';

const options = { enabled: true, minFileBytes: 32, minBytes: 4, avgBytes: 8, maxBytes: 12, maskBits: 30 };
for (const unit of ['a', 'é', '😀']) {
  for (const count of [4, 16, 32]) {
    const text = unit.repeat(count), config = normalizeSegmentsConfig({ cdc: options });
    const expected = buildCdcSegments({ text, languageId: 'text', options: config.cdc });
    const actual = discoverSegments({ text, ext: '.txt', relPath: 'sample.txt', mode: 'prose',
      languageId: 'text', segmentsConfig: { cdc: options } });
    if (Buffer.byteLength(text, 'utf8') < config.cdc.minFileBytes) {
      assert.equal(actual.length, 1);
      assert.equal(actual[0].type, 'prose', 'below-threshold discovery keeps the ordinary base segment');
      assert.deepEqual(actual[0].meta, {});
    } else {
      assert.deepEqual(actual.map(({ type, start, end, meta }) => ({ type, start, end, meta })),
        expected.map(({ type, start, end, meta }) => ({ type, start, end, meta })),
        `${unit}/${count}: discovery follows the normalized helper's UTF-8 byte eligibility`);
      assert.ok(actual.length > 1);
      assert.ok(actual.every(segment => segment.meta.algorithm === 'cdc' && segment.meta.cdc.encoding === 'utf8'));
      assert.ok(actual.every(segment => Buffer.byteLength(text.slice(segment.start, segment.end)) <= options.maxBytes));
    }
    assert.equal(actual.map(segment => text.slice(segment.start, segment.end)).join(''), text);
    assert.ok(actual.every(segment => !/[\uD800-\uDBFF]$/.test(text.slice(segment.start, segment.end))));
  }
}
assert.equal(CDC_SEGMENTATION_VERSION, '2.0.0', 'the direct byte-bounded algorithm keeps its existing contract');
assert.ok(Number(SEMANTIC_ANALYSIS_VERSIONS.sourceChunking) >= 43, 'replay must retire pre-byte-admission source chunks');
assert.equal(SEMANTIC_ANALYSIS_VERSIONS.vfsRouting, '8');
console.log('CDC discovery shares byte eligibility and preserves below-threshold base semantics.');
