import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-pyright-real-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
try {
  await fs.mkdir(path.join(root, 'package'));
  await fs.writeFile(path.join(root, 'pyproject.toml'), '[project]\nname = "qualification-package"\nversion = "0.1.0"\n');
  await fs.writeFile(path.join(root, 'package/__init__.py'), '');
  await fs.writeFile(path.join(root, 'package/math.py'), 'def add(x: int, y: int) -> int:\n    return x + y\n');
  const text = 'from .math import add\n\ndef total():\n    return add(1, 2)\n';
  await fs.writeFile(path.join(root, 'package/api.py'), text);
  registerDefaultToolingProviders();
  const result = await runToolingProviders({
    strict: true, repoRoot: root, buildRoot: root,
    toolingConfig: { enabledTools: ['pyright'], pyright: {
      cmd: path.join(process.cwd(), 'node_modules/.bin', process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver')
    } }, cache: { enabled: false }
  }, {
    documents: [{ virtualPath: 'package/api.py', text, languageId: 'python', effectiveExt: '.py', docHash: 'real-import-api' }],
    targets: [{
      chunkRef: { docId: 0, chunkUid: 'ck:real:total', chunkId: 'total', file: 'package/api.py', segmentUid: null, segmentId: null, range: { start: 23, end: text.length } },
      virtualPath: 'package/api.py', virtualRange: { start: 23, end: text.length }, symbolHint: { name: 'total', kind: 'function' }, languageId: 'python'
    }], kinds: ['types']
  });
  const facts = result.byChunkUid.get('ck:real:total');
  assert.ok(facts, JSON.stringify(result.diagnostics));
  assert.equal(facts.payload.returnType, 'int', 'installed Pyright infers imported function return type');
  assert.deepEqual(facts.payload.paramTypes || {}, {}, 'a zero-argument function cannot acquire parameters from its body');
  console.log(JSON.stringify({ provider: 'installed pyright', facts }));
} finally {
  await cleanupLspTestRuntime({ reason: 'real_pyright_imports' });
  await fs.rm(root, { recursive: true, force: true });
}
