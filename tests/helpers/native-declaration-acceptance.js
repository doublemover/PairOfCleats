import assert from 'node:assert/strict';
import { getNativeTreeSitterParser } from '../../src/lang/tree-sitter/native-runtime.js';
import { buildTreeSitterChunks } from '../../src/lang/tree-sitter/chunking.js';
import { smartChunk } from '../../src/index/chunking/dispatch.js';
import { prepareChunkIds } from '../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex, offsetToLine } from '../../src/shared/lines.js';
import { getLanguageForFile } from '../../src/index/language-registry.js';
import { enrichFlowFixture, assembleFlowFixture } from './chunk-flow-fixture.js';

export const nativeDeclarationOptions = { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false },
  astDataflowEnabled: false, controlFlowEnabled: false };

/** Assert real syntax, registered builder, dispatch/limits and persisted identity
 * without substituting fabricated nodes or accepting a heuristic fallback.
 */
export const checkNativeDeclarations = async ({ languageId, ext, text, build, preparedKey, expected, absent = [] }) => {
  console.log(`Native declaration acceptance: ${languageId} ${ext}`);
  const parser = getNativeTreeSitterParser(languageId);
  assert.ok(parser, languageId);
  const tree = parser.parse(text);
  try { assert.equal(tree.rootNode.hasError, false, `${languageId}: fixture must parse cleanly\n${tree.rootNode.toString()}`); }
  finally { tree.delete?.(); }
  let result;
  for (const useQueries of [false, true]) {
    const options = { ...nativeDeclarationOptions, treeSitter: { ...nativeDeclarationOptions.treeSitter, useQueries } };
    const native = buildTreeSitterChunks({ languageId, text, options });
    assert.ok(native?.length, languageId);
    const built = build(text, options);
    assert.ok(built?.length, `${languageId}: registered native builder`);
    for (const chunks of [native, built]) {
      for (const row of expected) {
        const matches = chunks.filter(chunk => chunk.name === row.name && chunk.kind === row.kind);
        assert.equal(matches.length, row.count ?? 1, `${languageId}: ${row.name}/${row.kind}: ${JSON.stringify(chunks.map(c => [c.name,c.kind]))}`);
        for (const chunk of matches) {
          if (row.source) assert.equal(text.slice(chunk.start, chunk.end), row.source, `${row.name}: complete source owner`);
          if (row.contains) assert.ok(text.slice(chunk.start, chunk.end).includes(row.contains), row.name);
          assert.ok(chunk.meta.signature, `${row.name}: signature`);
        }
      }
      for (const name of absent) assert.equal(chunks.some(chunk => chunk.name === name), false, name);
    }
    const limited = smartChunk({ text, ext, relPath: 'fixture' + ext, mode: 'code', context: {
      [preparedKey]: built, treeSitter: options.treeSitter, chunking: { maxBytes: 64, maxLines: 3 }
    } });
    for (const chunk of limited) {
      const owner = built.find(parent => parent.name === chunk.name && parent.kind === chunk.kind
        && parent.start <= chunk.start && parent.end >= chunk.end);
      assert.ok(owner, `${languageId}: dispatch/limits retain a real declaration owner`);
      assert.ok(text.slice(chunk.start, chunk.end).length > 0);
    }
    const lineIndex = buildLineIndex(text);
    const ids = await prepareChunkIds({ chunks: limited, text, relKey: 'fixture' + ext, containerExt: ext,
      containerLanguageId: languageId, lineIndex, vfsManifestConcurrency: 1, strict: true });
    assert.equal(new Set(limited.map(chunk => chunk.chunkUid)).size, limited.length);
    for (let index = 0; index < limited.length; index++) {
      const chunk = limited[index];
      assert.deepEqual(ids.chunkLineRanges[index], { startLine: offsetToLine(lineIndex, chunk.start),
        endLine: offsetToLine(lineIndex, Math.max(chunk.start, chunk.end - 1)) });
    }
    const lang = getLanguageForFile(ext, 'fixture' + ext);
    const payloads = built.map(chunk => {
      const docmeta = enrichFlowFixture({ text, chunk, lang, options, enabled: false });
      const payload = assembleFlowFixture({ text, chunk, docmeta, lang: lang.id, ext, emitFieldTokens: true });
      assert.equal(payload.name, chunk.name); assert.equal(payload.kind, chunk.kind);
      assert.equal(payload.start, chunk.start); assert.equal(payload.end, chunk.end);
      return payload;
    });
    result = { native, built, limited, payloads };
  }
  return result;
};
