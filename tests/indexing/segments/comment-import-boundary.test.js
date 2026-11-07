import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/segments/comment-import-boundary/')[1];
assert.ok(['module-only', 'no-comments', 'python-doc'].includes(mode));
const loaded = [];
const hook = registerHooks({ load(url, context, next) {
  const forbidden = url.includes('/src/lang/') && !url.endsWith('/src/lang/comment-occurrences.js')
    || ['/src/index/chunking/dispatch.js', '/src/index/language-registry/registry-data.js',
      '/src/index/build/tokenization/classification-helpers.js'].some(suffix => url.endsWith(suffix))
    || /\/node_modules\/(?:@babel\/parser|acorn|esprima|yaml|smol-toml|jsonc-parser)\//.test(url);
  assert.equal(forbidden, false, `Comment-only admission must not initialize ${url}`);
  loaded.push(url); return next(url, context);
} });
try {
  const { normalizeCommentConfig } = await import('../../../src/index/comments.js');
  const { buildLineIndex } = await import('../../../src/shared/lines.js');
  const { buildCommentMeta } = await import('../../../src/index/build/file-processor/cpu/meta.js');
  if (mode !== 'module-only') {
    const text = mode === 'python-doc' ? '## Useful parser independent documentation keeps real eligibility counts.\n' : 'const answer = 42;\n';
    const meta = buildCommentMeta({ text, ext: mode === 'python-doc' ? '.py' : '.js', mode: 'code',
      languageId: mode === 'python-doc' ? 'python' : 'javascript', lineIndex: buildLineIndex(text),
      normalizedCommentsConfig: normalizeCommentConfig({ minTokens: 1 }), tokenDictWords: new Set(), dictConfig: {} });
    assert.equal(meta.commentEntries.length, mode === 'python-doc' ? 1 : 0);
    if (mode === 'python-doc') assert.ok(meta.commentEntries[0].tokenCount > 0);
    assert.equal(meta.extraSegments.length, 0);
  }
  assert.ok(loaded.some(url => url.endsWith('/tokenization/sequence.js')));
  console.log(JSON.stringify({ mode, loadedModuleCount: loaded.length, loadedModules: loaded }));
} finally { hook.deregister(); }
