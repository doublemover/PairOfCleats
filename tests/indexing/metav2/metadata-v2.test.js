#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { validateMetadataV2 } from '../../../src/contracts/validators/analysis.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

const chunk = {
  chunkUid: 'ck:test:metadata-v2',
  file: 'src/example.js',
  ext: '.js',
  fileHash: 'deadbeef',
  fileHashAlgo: 'sha1',
  start: 10,
  end: 42,
  startLine: 2,
  endLine: 4,
  kind: 'FunctionDeclaration',
  name: 'makeWidget',
  segment: {
    segmentId: 'seg-1',
    type: 'code',
    languageId: 'javascript',
    ext: '.js',
    start: 0,
    end: 60,
    startLine: 1,
    endLine: 5,
    parentSegmentId: null,
    embeddingContext: 'code'
  }
};

const docmeta = {
  signature: 'makeWidget(opts)',
  params: ['opts'],
  returnType: 'Widget',
  inferredTypes: {
    returns: [{ type: 'Widget', source: 'tooling', confidence: 0.9 }],
    params: {
      opts: [{ type: 'WidgetOpts', source: 'inferred', confidence: 0.6 }]
    }
  },
  risk: {
    tags: ['command-exec'],
    sources: [{ name: 'req.body' }],
    sinks: [{ name: 'exec' }],
    flows: [{ source: 'req.body', sink: 'exec', scope: 'local' }]
  }
};

const meta = buildMetaV2({
  chunk,
  docmeta,
  toolInfo: { tool: 'pairofcleats', version: '0.0.0-test', configHash: 'deadbeef' }
});

assert.ok(meta, 'expected metaV2 output');
assert.ok(meta.chunkId, 'expected metaV2 chunkId');
assert.equal(meta.file, 'src/example.js');
assert.equal(meta.fileHash, 'deadbeef');
assert.equal(meta.fileHashAlgo, 'sha1');
assert.equal(meta.segment?.segmentId, 'seg-1');
assert.equal(meta.segment?.ext, '.js');
assert.equal(meta.signature, 'makeWidget(opts)');
assert.equal(meta.returns, 'Widget');
assert.equal(meta.types?.tooling?.returns?.[0]?.type, 'Widget');
assert.equal(meta.types?.inferred?.params?.opts?.[0]?.type, 'WidgetOpts');
assert.equal(meta.risk?.flows?.[0]?.sink, 'exec');

assert.equal(validateMetadataV2(meta).ok, true);
for (const overrides of [
  { range: { start: 42, end: 10 } },
  { range: { startLine: 4, endLine: 2 } },
  { range: { start: 0, end: 61 } },
  { range: { startLine: 1, endLine: 6 } },
  { segment: { start: 30, end: 20 } },
  { segment: { start: 11, end: 60 } },
  { segment: { startLine: 3, endLine: 5 } },
  { segment: { pageStart: 3, pageEnd: 2 } },
  { segment: { paragraphStart: 3, paragraphEnd: 2 } }
]) {
  const invalid = { ...meta, ...overrides };
  assert.equal(validateMetadataV2(invalid).ok, false, JSON.stringify(overrides));
  for (const name of ['chunk_meta', 'chunk_meta_cold']) {
    assert.equal(validateArtifact(name, [{ id: 0, start: 10, end: 42, metaV2: invalid }]).ok,
      false, `${name} must enforce the same metadata range contract`);
  }
}
assert.equal(validateMetadataV2({ ...meta, range: null, segment: null }).ok, true,
  'optional legacy range/segment fields remain supported');

console.log('metadata v2 test passed');
