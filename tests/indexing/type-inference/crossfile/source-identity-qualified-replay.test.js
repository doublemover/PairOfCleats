import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha1 } from '../../../../src/shared/hash.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';
import { buildCrossFileFingerprint } from '../../../../src/index/type-inference-crossfile/cache.js';
import { createCrossFileSourceReader, resolveCrossFileSourceIdentity } from '../../../../src/index/type-inference-crossfile/source-inputs.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-crossfile-source-'));
const text = 'function creator() { return new Widget(); }';
const makeChunks = source => [{ file: 'source.js', fileHash: sha1(source), fileHashAlgo: 'sha1',
  chunkUid: 'creator', name: 'creator', kind: 'function', start: 0, end: source.length,
  codeRelations: {}, docmeta: {} }];
const run = chunks => applyCrossFileInference({ rootDir: root, cacheRoot: path.join(root, 'cache'),
  chunks, enabled: true, useTooling: false, enableTypeInference: true });
try {
  await fs.writeFile(path.join(root, 'source.js'), text);
  const coldChunks = makeChunks(text);
  const cold = await run(coldChunks);
  assert.equal(cold.cacheHit, false);
  assert.equal(cold.sourceReadCoverage.status, 'qualified');
  assert.equal(cold.sourceReadCoverage.readFiles, 1);
  assert.ok(coldChunks[0].docmeta.inferredTypes.returns.some(row => row.type === 'Widget'));
  const warmChunks = makeChunks(text);
  assert.equal((await run(warmChunks)).cacheHit, true);
  assert.deepEqual(warmChunks, coldChunks, 'unchanged producer bytes preserve actual replay');
  const changed = text.replace('Widget', 'Gadget');
  await fs.writeFile(path.join(root, 'source.js'), changed);
  assert.notEqual(buildCrossFileFingerprint({ chunks: makeChunks(text), enableTypeInference: true }),
    buildCrossFileFingerprint({ chunks: makeChunks(changed), enableTypeInference: true }));
  const updated = makeChunks(changed);
  assert.equal((await run(updated)).cacheHit, false, 'same offsets/relations cannot alias changed source');
  assert.ok(updated[0].docmeta.inferredTypes.returns.some(row => row.type === 'Gadget'));
  await assert.rejects(run(makeChunks('function creator() { return new Stale(); }')),
    { code: 'ERR_FILE_INTEGRITY' }, 'live worktree cannot be sliced under another producer identity');

  const unknown = () => makeChunks(changed).map(({ fileHash, fileHashAlgo, ...chunk }) => chunk);
  assert.equal((await run(unknown())).sourceReadCoverage.status, 'unqualified');
  assert.equal((await run(unknown())).cacheHit, false, 'missing byte identity cannot authorize replay');
  assert.throws(() => createCrossFileSourceReader({ rootDir: root,
    chunks: [...makeChunks(text), ...makeChunks(changed)] }), { code: 'ERR_CROSS_FILE_SOURCE_IDENTITY' });
  assert.throws(() => resolveCrossFileSourceIdentity({ ...makeChunks(text)[0],
    metaV2: { fileHash: sha1(changed), fileHashAlgo: 'sha1' } }), { code: 'ERR_CROSS_FILE_SOURCE_IDENTITY' });
  assert.equal(resolveCrossFileSourceIdentity({ fileHash: sha1(text), metaV2: { fileHashAlgo: 'sha1' } }), null,
    'an identity cannot be assembled across incomplete producer handoffs');
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  const reader = createCrossFileSourceReader({ rootDir: root, chunks: unknown(), read: async () => { throw denied; } });
  await assert.rejects(reader.getText('source.js'), error => error === denied,
    'operational errors cannot masquerade as an empty source');
  await assert.rejects(reader.getText('unrelated.js'), { code: 'ERR_CROSS_FILE_SOURCE_SCOPE' },
    'source reads cannot acquire an unadmitted file through an otherwise contained path');
  const escaped = createCrossFileSourceReader({ rootDir: root, chunks: [{ file: '../outside.js' }] });
  await assert.rejects(escaped.getText('../outside.js'), { code: 'ERR_UNSAFE_FILE_PATH' });
  await fs.rm(path.join(root, 'source.js'));
  const missing = createCrossFileSourceReader({ rootDir: root, chunks: makeChunks(changed) });
  await assert.rejects(missing.getText('source.js'), { code: 'ERR_CROSS_FILE_SOURCE_MISSING' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Cross-file source identity, qualified warm replay and source read authority controls passed.');
