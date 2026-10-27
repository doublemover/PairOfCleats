#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
import { checksumString } from '../../../src/shared/hash.js';

applyTestEnv();
let hashCalls = 0;
globalThis.__vfsSpanHash = () => { hashCalls++; };
const originalHash = new URL('../../../src/index/tooling/vfs/doc-hash.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/vfs/documents.js') && specifier === './doc-hash.js') {
      return { url: 'vfs-span:hash', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'vfs-span:hash') return { format: 'module', shortCircuit: true, source: `
      import {computeDocHash as original} from ${JSON.stringify(originalHash)};
      export {buildDocHashCacheKey} from ${JSON.stringify(originalHash)};
      export const computeDocHash = (...args) => {globalThis.__vfsSpanHash(); return original(...args);};` };
    return next(url, context);
  }
});
try {
  const { buildToolingVirtualDocuments, buildVfsManifestRowsForFile } = await import('../../../src/index/tooling/vfs.js');
  const file = 'source.ts', text = 'abcdefghij';
  const base = { file, ext: '.ts', lang: 'typescript', start: 0, end: text.length, chunkUid: 'fixture:span' };
  const segment = { start: 3, end: 8, segmentUid: 'fixture:segment', languageId: 'typescript', ext: '.ts' };
  const build = (chunks, extra = {}) => buildToolingVirtualDocuments({ chunks,
    fileTextByPath: new Map([[file, text]]), strict: true, ...extra });
  const manifest = (chunks, extra = {}) => buildVfsManifestRowsForFile({ chunks,
    containerPath: file, containerExt: '.ts', fileText: text, strict: true, ...extra });
  const invalid = [
    ...[[-1, 2], [0, 11], [.5, 2], [NaN, 2], [0, Infinity], [5, 4], [0, Number.MAX_SAFE_INTEGER],
      [0, Number.MAX_SAFE_INTEGER + 1]].map(([start, end]) => ({ ...base, start, end })),
    ...[[-1, 8], [3, 100], [3.5, 8], [9, 8], [NaN, 8]].map(([start, end]) => (
      { ...base, start: 4, end: 6, segment: { ...segment, start, end } }
    )),
    { ...base, start: 1, end: 2, segment }, // Numerically local, but not in the declared container occurrence.
    { ...base, start: 4, end: 9, segment },
    { ...base, coordinateFrame: 'invented' },
    { ...base, coordinateFrame: 'segment' }
  ];
  for (const chunk of invalid) {
    for (const operation of [build, manifest]) {
      hashCalls = 0;
      await assert.rejects(operation([base, chunk]), { code: 'ERR_VFS_SOURCE_SPAN' });
      assert.equal(hashCalls, 0, 'all original spans are admitted before any document/manifest hash');
    }
  }
  const adjacent = [
    { ...base, start: 0, end: 5, segment: { ...segment, start: 0, end: 5 } },
    { ...base, start: 5, end: 10, chunkUid: 'fixture:second', segment: { ...segment, start: 5, end: 10, segmentUid: 'fixture:second' } }
  ];
  await assert.rejects(build([{ ...adjacent[0], end: 7 }, adjacent[1]], { coalesceSegments: true }),
    { code: 'ERR_VFS_SOURCE_SPAN', reason: 'chunk-bounds' }, 'coalescing cannot admit a range outside its original segment');
  const relative = { ...base, start: 1, end: 3, segment, coordinateFrame: 'segment' };
  for (const coalesceSegments of [false, true]) {
    const admitted = await build([relative], { coalesceSegments });
    assert.deepEqual(admitted.targets[0].chunkRef.range, { start: 4, end: 6 });
    assert.deepEqual(admitted.targets[0].virtualRange, { start: 1, end: 3 });
    assert.equal(admitted.documents[0].text.slice(1, 3), text.slice(4, 6));
    assert.equal(admitted.sourceAdmission.complete, true);
  }
  const logs = [];
  const partial = await build([base, ...Array(20).fill(invalid[0])], { strict: false, log: line => logs.push(line) });
  assert.equal(partial.documents.length, 1); assert.equal(partial.targets.length, 1);
  assert.equal(partial.sourceAdmission.complete, false);
  assert.equal(partial.sourceAdmission.rejectedChunks, 20);
  assert.equal(partial.sourceAdmission.samples.length, 16);
  assert.equal(logs.length, 1, 'permissive diagnostic volume is bounded');
  const rows = await manifest([base, invalid[0]], { strict: false, log: () => {} });
  assert.equal(rows.length, 1); assert.equal(rows.sourceAdmission.complete, false);
  assert.equal(rows.sourceAdmission.rejectedChunks, 1);
  assert.equal(JSON.parse(JSON.stringify(rows))[0].sourceAdmission, undefined, 'receipt does not alter persisted row format');
  const descriptorRows = await manifest([{ file, lang: 'typescript', segment }]);
  assert.equal(descriptorRows.length, 1, 'manifest-only descriptors do not invent target ranges');
  await assert.rejects(manifest([{ file, segment, start: 4 }]), { code: 'ERR_VFS_SOURCE_SPAN' });
  const noSource = await manifest([base], { fileText: null, strict: false, log: () => {} });
  assert.equal(noSource.sourceAdmission.complete, false);
  assert.equal(noSource.sourceAdmission.reasons['missing-source'], 1);
  for (const source of ['', 'A😀B']) {
    const whole = { ...base, start: 0, end: source.length };
    for (const [start, end] of [[0, 0], [source.length, source.length], [0, source.length]]) {
      const out = await build([{ ...whole, start, end }], { fileTextByPath: new Map([[file, source]]) });
      assert.equal(out.documents[0].text.slice(out.targets[0].virtualRange.start, out.targets[0].virtualRange.end), source.slice(start, end));
    }
    if (source) {
      for (const chunk of [{ ...whole, start: 2 }, { ...whole, end: 2 },
        { ...whole, segment: { ...segment, start: 0, end: 2 } }]) {
        await assert.rejects(build([chunk], { fileTextByPath: new Map([[file, source]]) }),
          error => error.code === 'ERR_VFS_SOURCE_SPAN' && error.reason.includes('surrogate'));
      }
    }
  }
  const combined = await build(adjacent, { coalesceSegments: true });
  for (const target of combined.targets) {
    assert.equal(combined.documents[0].text.slice(target.virtualRange.start, target.virtualRange.end),
      text.slice(target.chunkRef.range.start, target.chunkRef.range.end));
  }
  for (const row of await manifest(adjacent)) {
    const bytes = text.slice(row.segmentStart, row.segmentEnd);
    assert.equal(row.docHash, `xxh64:${(await checksumString(bytes)).value}`);
  }
  const { prepareToolingPassDocuments, runToolingPass } = await import('../../../src/index/type-inference-crossfile/tooling.js');
  const prepared = await prepareToolingPassDocuments({ chunks: [base, invalid[0]], fileTextByFile: new Map([[file, text]]),
    toolingConfig: { strict: false }, log: () => {} });
  assert.equal(prepared.sourceAdmission.complete, false, 'production preparation retains incomplete source admission');
  assert.equal(prepared.sourceAdmission.rejectedChunks, 1);
  const emptyPass = await runToolingPass({ rootDir: process.cwd(), chunks: [invalid[0]],
    fileTextByFile: new Map([[file, text]]), toolingConfig: { strict: false }, log: () => {} });
  assert.equal(emptyPass.toolingDegradedWarnings, 1, 'no-provider early exit cannot erase source omissions');
  assert.equal(emptyPass.toolingSourceAdmission.complete, false);
  const readFailure = new Error('source-read-unavailable');
  await assert.rejects(build([base], { strict: false, fileTextByPath: () => { throw readFailure; } }),
    error => error === readFailure, 'operational source-read errors must not become malformed-span omissions');
} finally { hooks.deregister(); delete globalThis.__vfsSpanHash; }
console.log('VFS UTF-16 source spans are admitted before coalescing/hashing, with explicit frames and bounded omissions.');
