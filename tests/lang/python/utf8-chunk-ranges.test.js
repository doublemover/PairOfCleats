import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { buildPythonChunksFromAst, shutdownPythonAstPool } from '../../../src/lang/python.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const priorEncoding = process.env.PYTHONIOENCODING;
// Exercise the actual transport under a deliberately non-UTF-8 host locale.
// Correctness must come from the worker's byte protocol, not ambient settings.
process.env.PYTHONIOENCODING = 'cp1252';
try {
  for (const [name, source, newline] of [
    ['f', "def f(): return 'éééééééééé'", '\n'],
    ['f', "def f(): return '漢字漢字'", '\n'],
    ['f', "def f(): return '😀😃🚀'", '\n'],
    ['café', "def café(): return '漢😀'", '\r\n'],
    ['f', 'def f():\n    value = "é漢😀"\n    return value', '\n'],
    ['f', 'def f():\n    """é漢😀"""\n    return "ok"', '\n'],
    ['f', 'def f(): return "ascii"', '\r\n']
  ]) {
    const text = `${source}${newline}following = 1${newline}def after(): return 2${newline}`;
    const { context } = await buildLanguageContext({ ext: '.py', relPath: 'package/unicode.py', mode: 'code', text,
      options: { pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 } } });
    assert.ok(context.pythonAst, 'real CPython byte-column metadata is required');
    const chunk = context.pythonChunks.find(entry => entry.name === name);
    assert.ok(chunk);
    assert.equal(chunk.start, 0);
    assert.equal(chunk.end, source.length, 'half-open UTF-16 end excludes the following statement');
    assert.equal(text.slice(chunk.start, chunk.end), source);
    assert.ok(chunk.end <= text.length);
    assert.equal(chunk.meta.endLine, source.split('\n').length);
    if (source.includes('"""')) assert.equal(chunk.meta.docstring, 'é漢😀');
    const after = context.pythonChunks.find(entry => entry.name === 'after');
    assert.equal(text.slice(after.start, after.end), 'def after(): return 2');
  }
  const text = 'def café(): pass';
  for (const endCol of [8, Buffer.byteLength(text) + 1, -1, 1.5]) {
    assert.throws(() => buildPythonChunksFromAst(text, { defs: [
      { name: 'café', startLine: 1, startCol: 0, endLine: 1, endCol }
    ] }), RangeError, 'invalid byte boundaries cannot leak into the next source range');
  }
} finally {
  await shutdownPythonAstPool();
  if (priorEncoding === undefined) delete process.env.PYTHONIOENCODING;
  else process.env.PYTHONIOENCODING = priorEncoding;
}
console.log('Real Python UTF-8 columns map to exact UTF-16 chunk bounds for accents/CJK/astral/CRLF/multiline and ASCII controls.');
