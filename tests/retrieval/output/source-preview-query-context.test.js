#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSourcePreviewReader, readSourcePreview, formatSourcePreview } from '../../../src/retrieval/output/format/source.js';
import { formatShortChunk } from '../../../src/retrieval/output/format/short.js';
import { formatFullChunk } from '../../../src/retrieval/output/format/full.js';
import { buildHighlightRegex } from '../../../src/retrieval/cli/highlight.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { createSearchOutputOptions, createSearchOutputHitState, captureSearchOutputStdout } from '../helpers/search-output-fixture.js';

applyTestEnv();
const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-preview-'));
try {
  const source = Array.from({ length: 30 }, (_, index) => index === 21
    ? '  return Needle + "a+b[0]";'
    : `  // context ${index + 1}`).join('\n');
  await fs.writeFile(path.join(repo, 'source.js'), source);
  await fs.writeFile(path.join(repo, 'other.js'), source);
  const hit = { file: 'source.js', name: 'find', start: 0, end: source.length, startLine: 999, endLine: 1028 };
  const preview = readSourcePreview(repo, hit, { maxLines: 3, queryTokens: ['needle'] });
  assert.equal(preview.startLine, 21, 'preview line numbers come from the working tree, not stale index lines');
  assert.equal(preview.lines.length, 3);
  assert.deepEqual(preview.matchLines, [1]);
  assert.match(preview.lines[1], /Needle/);
  assert.equal(preview.truncatedBefore, true);
  assert.equal(preview.truncatedAfter, true);
  assert.match(formatSourcePreview(preview, { styled: false, columns: 60 }), /> 22 \|.*Needle/);
  const literal = readSourcePreview(repo, hit, { maxLines: 3, queryTokens: ['a+b[0]'] });
  assert.deepEqual(literal.matchLines, [1], 'query tokens are literal text, never regular expressions');
  const semantic = readSourcePreview(repo, hit, { queryTokens: ['semantic-only'] });
  assert.equal(semantic.startLine, 1);
  assert.deepEqual(semantic.matchLines, [], 'semantic results need not contain literal query text');
  assert.deepEqual(readSourcePreview(repo, hit, { queryTokens: ['\x1b[31m'] }).matchLines, []);

  const read = createSourcePreviewReader(repo, { maxFiles: 1, maxBytes: Buffer.byteLength(source) });
  assert.ok(read(hit));
  assert.ok(read(hit), 'multiple hits in one file reuse its bounded read');
  assert.equal(read({ ...hit, file: 'other.js' }), null, 'the render-wide path budget applies');
  assert.equal(createSourcePreviewReader(repo, { maxBytes: 1 })(hit), null);
  assert.equal(createSourcePreviewReader(repo, { maxFiles: 0 })(hit), null);

  const changed = source.replace('Needle', 'LATEST');
  await fs.writeFile(path.join(repo, 'source.js'), changed);
  assert.equal(read(hit, { queryTokens: ['Needle'], maxLines: 3 }), null,
    'a changed source revokes the original render snapshot instead of showing stale text');
  assert.match(readSourcePreview(repo, hit, { queryTokens: ['LATEST'], maxLines: 3 }).lines.join('\n'), /LATEST/,
    'a new render must not reuse old source text');
  const args = { chunk: hit, index: 1, mode: 'code', color, queryTokens: ['LATEST'], rootDir: repo,
    layout: { columns: 80, styled: false, cacheKey: 'cols:80' } };
  assert.match(formatShortChunk(args), /LATEST/);
  await fs.writeFile(path.join(repo, 'source.js'), changed.replace('LATEST', 'NEWEST'));
  assert.match(formatShortChunk({ ...args, queryTokens: ['NEWEST'] }), /NEWEST/,
    'short formatter source text must bypass persistent format caches');

  const longLine = `${' '.repeat(300)}const value = "needle 👨‍👩‍👧‍👦"; ${'x'.repeat(300)}`;
  await fs.writeFile(path.join(repo, 'long.js'), longLine);
  const focused = readSourcePreview(repo, { ...hit, file: 'long.js', end: longLine.length }, { queryTokens: ['needle'] });
  const rendered = formatSourcePreview(focused, { styled: false, columns: 40 });
  assert.match(rendered, /needle/, 'horizontal clipping keeps query context visible');
  assert.equal(rendered.isWellFormed(), true, 'clipping must not leave unmatched UTF-16 surrogates');
  assert.doesNotMatch(rendered, /\x1b/);
  const expandingCase = `${'İ'.repeat(100)} needle after-case-expansion`;
  await fs.writeFile(path.join(repo, 'unicode.js'), expandingCase);
  const unicode = readSourcePreview(repo, { ...hit, file: 'unicode.js', end: expandingCase.length }, { queryTokens: ['needle'] });
  assert.match(formatSourcePreview(unicode, { styled: false, columns: 40 }), /needle/,
    'case-folded match offsets must map back to the original source string');
  for (const [original, query] of [['café', 'cafe\u0301'], ['ｃａｆé', 'café'],
    ['CAFÉ', 'café'], ['ﬃ', 'ffi'], ['각', '각']]) {
    const body = Array.from({ length: 30 }, (_, index) => index === 21
      ? 'İ'.repeat(100) + ' '.repeat(200) + original + ' original source tail'
      : '// context ' + index).join('\n');
    await fs.writeFile(path.join(repo, 'normalized.js'), body);
    const chunk = { ...hit, file: 'normalized.js', end: body.length, headline: original };
    const tokens = [query.normalize('NFKD')];
    const preview = readSourcePreview(repo, chunk, { maxLines: 3, maxChars: 120, queryTokens: tokens });
    assert.equal(preview.startLine, 21, 'normalized source match chooses the actual late line');
    assert.deepEqual(preview.matchLines, [1]);
    const output = formatSourcePreview(preview, { styled: false, columns: 40 });
    assert.ok(output.split('\n').some(line => line.includes('> ') && line.includes(original)));
    assert.equal(output.isWellFormed(), true);
    for (const format of [formatShortChunk, formatFullChunk]) {
      const text = format({ chunk, index: 0, mode: 'code', color, queryTokens: tokens,
        rx: buildHighlightRegex(tokens), matched: true, rootDir: repo,
        layout: { columns: 55, styled: false, cacheKey: 'normalized-55' } });
      assert.ok(text.split('\n').some(line => line.includes('> ') && line.includes(original)),
        'actual direct formatter retains original graphemes and marked query context');
      assert.match(text, /Matched:/);
    }
    const rendered = await captureSearchOutputStdout(() => renderSearchOutput(createSearchOutputOptions({
      emitOutput: true, jsonOutput: false, jsonCompact: false, plain: true, rootDir: repo, color,
      queryTokens: tokens, highlightRegex: buildHighlightRegex(tokens), rawQuery: query,
      ...createSearchOutputHitState({ codeHits: [{ ...chunk, id: 0, score: 1 }] })
    })));
    assert.ok(rendered.split('\n').some(line => line.includes('> ') && line.includes(original)),
      'the actual CLI render owner passes normalized tokens into source window selection');
  }
  console.log('query-centered bounded source preview test passed');
} finally {
  await fs.rm(repo, { recursive: true, force: true });
}
