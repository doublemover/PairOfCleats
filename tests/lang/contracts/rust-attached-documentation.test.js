#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter/chunking.js';
import { RUST_ATTACHED_DOCUMENTATION_VERSION, RUST_PREFIX_RANGE_LIMIT } from '../../../src/lang/tree-sitter/rust-prefix.js';
import { readCachedBundle, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
import { enrichFlowFixture, assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const options = { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: true },
  astDataflowEnabled: false, controlFlowEnabled: false };
const text = [
  '//! Module documentation stays distinct.',
  '// Ordinary preamble.',
  '/// First 😀 documentation mentions unsafe fn(fake) -> Wrong and #[invented].',
  '#[inline]',
  'pub fn first(actual: i32) -> i32 { actual }',
  '',
  '#[cfg(any(',
  '  target_os = "windows",',
  '  target_os = "linux"',
  '))]',
  '/// Second documentation after a multiline attribute.',
  '#[allow(dead_code)]',
  'fn second(real: u8) -> u8 { real }',
  '',
  '/** Third block.',
  ' * More details.',
  ' */',
  '#[inline]',
  'pub async fn third(value: u8) -> u8 { value }',
  '',
  '// Ordinary unsafe fourth comment.',
  '//// Four slashes are an ordinary comment.',
  '/* Ordinary block, not a documentation node. */',
  'fn fourth() {}',
  '',
  '/// Generic bound and parameter attributes must not provide parameter names.',
  '#[allow(dead_code)]',
  'fn callback<T: Fn(u8) -> u8>(#[allow(unused_variables)] handler: T, amount: u8, pair: (u8, u8)) -> u8 { handler(amount) }',
  'fn pointer(handler: unsafe fn(u8) -> u8, amount: u8) -> u8 { unsafe { handler(amount) } }',
  '',
  'struct Holder;',
  'impl Holder {',
  '  //! Inner implementation documentation.',
  '  /// Actual method documentation.',
  '  #[inline]',
  '  pub fn method(&self, amount: u8) -> u8 { amount }',
  '}',
  'trait Service {',
  '  /// Bodyless method documentation.',
  '  #[must_use]',
  '  fn required(&self, value: u8) -> u8;',
  '}',
  ''
].join('\r\n');
const expected = new Map([
  ['first', ['First 😀 documentation mentions unsafe fn(fake) -> Wrong and #[invented].', ['actual'], ['pub'], ['inline']]],
  ['second', ['Second documentation after a multiline attribute.', ['real'], [], ['cfg', 'allow']]],
  ['third', ['Third block.\nMore details.', ['value'], ['pub', 'async'], ['inline']]],
  ['fourth', ['', [], [], []]],
  ['callback', ['Generic bound and parameter attributes must not provide parameter names.', ['handler', 'amount', 'pair'], [], ['allow']]],
  ['pointer', ['', ['handler', 'amount'], [], []]],
  ['Holder.method', ['Actual method documentation.', ['self', 'amount'], ['pub'], ['inline']]],
  ['Service.required', ['Bodyless method documentation.', ['self', 'value'], [], ['must_use']]]
]);
let retained;
for (const useQueries of [false, true]) {
  const nativeOptions = { ...options, treeSitter: { ...options.treeSitter, useQueries } };
  const prepared = await buildLanguageContext({ text, ext: '.rs', relPath: 'fixture.rs', mode: 'code', options: nativeOptions });
  const chunks = prepared.context.rustChunks;
  assert.ok(chunks?.length, 'the actual native converter and registered Rust preparation must produce declarations');
  const payloads = [];
  for (const [name, [doc, params, modifiers, decorators]] of expected) {
    const chunk = chunks.find(row => row.name === name); assert.ok(chunk, name);
    const references = chunk.meta.attachedDocumentation;
    assert.equal(references.schemaVersion, RUST_ATTACHED_DOCUMENTATION_VERSION);
    assert.equal(references.coverageScope, 'outer-prefix-syntax'); assert.equal(references.coverage, 'complete');
    assert.equal(references.coordinateSpace, 'utf16'); assert.equal(references.omittedRanges, 0);
    assert.deepEqual(references.owner, { start: chunk.meta.definitionStart, end: chunk.meta.definitionEnd });
    assert.ok(chunk.start <= references.owner.start && chunk.end >= references.owner.end);
    assert.equal(references.comments.length > 0, Boolean(doc), name);
    for (const comment of references.comments) {
      assert.equal(comment.role, 'outer-documentation');
      assert.ok(comment.start >= chunk.start && comment.end <= chunk.meta.definitionStart);
      assert.match(text.slice(comment.start, comment.end), /^(?:\/\/\/[^/]|\/\*\*)/u);
      assert.equal(text.slice(comment.start, comment.end).includes('Inner implementation'), false);
    }
    const projected = enrichFlowFixture({ text, chunk, lang: prepared.lang, context: prepared.context,
      options: nativeOptions, enabled: false });
    assert.equal(projected.doc, doc, name); assert.deepEqual(projected.params, params, name);
    assert.deepEqual(projected.modifiers, modifiers, name); assert.deepEqual(projected.decorators, decorators, name);
    assert.deepEqual(projected.attachedDocumentation, references);
    assert.equal(projected.decorators.includes('invented'), false);
    const payload = assembleFlowFixture({ text, chunk, docmeta: projected, lang: 'rust', ext: '.rs' });
    assert.equal(payload.docmeta.doc, doc); assert.deepEqual(payload.docmeta.attachedDocumentation, references);
    payloads.push(payload);
  }
  const first = chunks.find(row => row.name === 'first'), second = chunks.find(row => row.name === 'second');
  assert.equal(first.start, 0, 'existing full source coverage retains the module preamble independently of doc attribution');
  assert.ok(text.slice(second.start, second.end).startsWith('#[cfg(any('));
  assert.equal(first.meta.returns, 'i32'); assert.equal(chunks.find(row => row.name === 'callback').meta.returns, 'u8');
  assert.equal(chunks.find(row => row.name === 'Service.required').meta.bodyless, true);
  const warm = await buildLanguageContext({ text, ext: '.rs', relPath: 'fixture.rs', mode: 'code', options: nativeOptions });
  assert.deepEqual(warm.context.rustChunks, chunks, 'warm native chunk reuse retains attached source roles and semantic fields');
  retained = payloads;
}
const oversized = Array.from({ length: RUST_PREFIX_RANGE_LIMIT + 3 }, (_, index) => `/// Documentation ${index}.`).join('\n') + '\nfn many() {}';
const many = buildTreeSitterChunks({ text: oversized, languageId: 'rust', options }).find(row => row.name === 'many');
assert.equal(many.start, 0); assert.equal(many.end, oversized.length);
assert.equal(many.meta.attachedDocumentation.coverage, 'partial');
assert.equal(many.meta.attachedDocumentation.comments.length, RUST_PREFIX_RANGE_LIMIT);
assert.equal(many.meta.attachedDocumentation.omittedRanges, 3);
assert.ok(many.meta.docstring.startsWith('Documentation 0.')); assert.ok(many.meta.docstring.length <= 300);

const { dir } = await prepareIsolatedTestCacheDir('rust-attached-documentation');
const absPath = path.join(dir, 'fixture.rs'); await fs.writeFile(absPath, text);
const stat = await fs.stat(absPath), bundleDir = path.join(dir, 'bundles'); await fs.mkdir(bundleDir);
const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
manifest.files['fixture.rs'] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest,
  relKey: 'fixture.rs', fileStat: stat, fileHash: sha1(text), fileChunks: retained, bundleFormat: 'json', fileRelations: {} });
const { cachedBundle } = await readCachedBundle({ enabled: true, absPath, relKey: 'fixture.rs', fileStat: stat,
  manifest, bundleDir, bundleFormat: 'json' });
assert.deepEqual(cachedBundle.chunks.map(row => row.docmeta), retained.map(row => row.docmeta));
console.log('Native Rust outer documentation and declaration fields survive registered enrichment, payload assembly and replay.');
