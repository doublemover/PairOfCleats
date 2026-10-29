import assert from 'node:assert/strict';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';

const payload = (ext, imports, relationsEnabled = true, effectiveExt = ext) => buildChunkPayload({
  chunk: { start: 0, end: 12, startLine: 1, endLine: 1, name: 'example', kind: 'Function' },
  rel: `example${ext}`, relKey: `example${ext}`, ext, effectiveExt, tokens: [], tokenIds: [], seq: [],
  codeRelations: {}, stats: {}, minhashSig: [], emitFieldTokens: false,
  dictWords: new Set(), dictConfig: {}, fileRelations: { imports }, relationsEnabled,
  toolInfo: { tool: 'test', version: '0.0.0' }, gitMeta: {}
});
for (const ext of ['.js', '.mjs', '.cjs', '.jsx']) {
  const chunk = payload(ext, ['node:fs', 'node:fs/promises', 'fs', 'fs/promises', 'path', 'assert/strict',
    './local.js', '../other.js', '@scope/pkg', 'left-pad', 'left-pad']);
  assert.deepEqual(chunk.externalDocs, ['https://www.npmjs.com/package/@scope/pkg', 'https://www.npmjs.com/package/left-pad']);
}
for (const ext of ['.py', '.pyi']) {
  const chunk = payload(ext, ['os', 'os.path', 'sys', 'urllib.parse', 'collections.abc', 'tomllib',
    '.relative', 'requests', 'requests.api', 'numpy.linalg']);
  assert.deepEqual(chunk.externalDocs, ['https://pypi.org/project/numpy', 'https://pypi.org/project/requests']);
}
assert.deepEqual(payload('.html', ['node:fs', 'fs', '@scope/pkg'], true, '.js').externalDocs,
  ['https://www.npmjs.com/package/@scope/pkg'], 'effective embedded language owns package attribution');
assert.deepEqual(payload('.js', ['left-pad'], false).externalDocs, []);
assert.deepEqual(payload('.js', []).externalDocs, []);
console.log('Indexed chunk payloads omit runtime standard libraries while retaining actual package documentation links.');
