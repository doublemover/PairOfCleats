import assert from 'node:assert/strict';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { buildPythonChunksFromAst, shutdownPythonAstPool, extractPythonDocMeta } from '../../../src/lang/python.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

// Authored only. Future acceptance runs actual CPython preparation once, then
// refuses any subsequent AST definition access while dispatch reuses its result.
ensureTestingEnv(process.env);
const text = 'def control(value: int) -> int:\n    """prepared source metadata"""\n    return value\n';
try {
  const python = LANGUAGE_REGISTRY.find(adapter => adapter.id === 'python');
  const context = await python.prepare({ text, mode: 'code', relPath: 'source.py', options: {
    pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, taskTimeoutMs: 5000 }
  } });
  assert.ok(context.pythonAst && !context.pythonAst.error, 'prepared target requires the actual Python AST runtime');
  assert.deepEqual(context.pythonChunks, buildPythonChunksFromAst(text, context.pythonAst));
  const originalDefs = context.pythonAst.defs;
  Object.defineProperty(context.pythonAst, 'defs', { configurable: true,
    get() { assert.fail('dispatch must not reconvert the original AST or request another parse'); } });
  const chunks = smartChunk({ text, ext: '.py', mode: 'code', context });
  assert.deepEqual(chunks, context.pythonChunks);
  assert.equal(chunks[0], context.pythonChunks[0]);
  assert.equal(extractPythonDocMeta(chunks[0], null, context).doc, 'prepared source metadata');
  Object.defineProperty(context.pythonAst, 'defs', { value: originalDefs, configurable: true, writable: true });
} finally { await shutdownPythonAstPool(); }
console.log('Actual Python prepared AST/dispatch handoff control authored; execution deferred.');
