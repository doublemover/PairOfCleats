import assert from 'node:assert/strict';
import path from 'node:path';

import { createArtifactWriter } from '../../../src/index/build/artifacts/writer.js';

const outDir = path.join(process.cwd(), '.testCache', 'artifact-writer-heuristics');
const writes = [];

const writer = createArtifactWriter({
  outDir,
  enqueueWrite: (label, job, meta = {}) => {
    writes.push({ label, job, meta });
  },
  addPieceFile: () => {},
  formatArtifactLabel: (filePath) => path.relative(outDir, filePath).replace(/\\/g, '/'),
  compressionEnabled: true,
  compressionMode: 'gzip',
  compressionKeepRaw: false,
  compressionGzipOptions: null,
  compressionMinBytes: 1024,
  compressionMaxBytes: 128 * 1024 * 1024,
  compressibleArtifacts: new Set(['tiny', 'normal', 'huge', 'arr']),
  compressionOverrides: {},
  jsonArraySerializeShardThresholdMs: 1,
  jsonArraySerializeShardMaxBytes: 64 * 1024
});

writer.enqueueJsonArray('tiny', [{ a: 1 }], {
  compressible: true,
  estimatedBytes: 256
});
assert.ok(
  writes.at(-1)?.label?.endsWith('tiny.json'),
  'expected tiny payload to skip compression because expected read benefit is too small'
);

writer.enqueueJsonArray('normal', Array.from({ length: 256 }, (_, index) => ({ index, text: 'x'.repeat(64) })), {
  compressible: true,
  estimatedBytes: 512 * 1024
});
assert.ok(
  writes.at(-1)?.label?.endsWith('normal.json.gz'),
  'expected medium payload to use configured compression'
);

writer.enqueueJsonArray('huge', [{ a: 1 }], {
  compressible: true,
  estimatedBytes: 1024 * 1024 * 1024
});
assert.ok(
  writes.at(-1)?.label?.endsWith('huge.json'),
  'expected very large payload to skip compression when cost likely outweighs read benefit'
);

const marker = writes.length;
writer.enqueueJsonArraySharded(
  'arr',
  Array.from({ length: 2000 }, (_, index) => ({ index, text: 'y'.repeat(80) })),
  {
    maxBytes: 0,
    estimatedBytes: 4 * 1024 * 1024,
    piece: { type: 'chunks', name: 'arr' }
  }
);

const wroteSharded = writes.slice(marker).some((entry) => entry.label.endsWith('arr.parts'));
assert.ok(
  wroteSharded,
  'expected serialize-time fallback to force sharded output when predicted serialization exceeds threshold'
);

console.log('artifact writer heuristics test passed');
