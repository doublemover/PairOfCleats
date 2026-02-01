#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';

const chunk = {
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
assert.equal(meta.signature, 'makeWidget(opts)');
assert.equal(meta.returns, 'Widget');
assert.equal(meta.types?.tooling?.returns?.[0]?.type, 'Widget');
assert.equal(meta.types?.inferred?.params?.opts?.[0]?.type, 'WidgetOpts');
assert.equal(meta.risk?.flows?.[0]?.sink, 'exec');

console.log('metadata v2 test passed');
