import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';

const { dir } = await prepareIsolatedTestCacheDir('document-context-hover-policy');
const repoRoot = path.join(dir, 'repo'), vfsRoot = path.join(dir, 'vfs');
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null
} });
const text = 'int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }\n';
const documents = ['exact', 'weak'].map(name => ({ virtualPath: `src/${name}.cpp`, text,
  languageId: 'cpp', effectiveExt: '.cpp', docHash: `context-${name}` }));
const targets = documents.flatMap((doc, id) => ['add', 'sub'].map(name => {
  const start = text.indexOf(name);
  return { virtualPath: doc.virtualPath, virtualRange: { start, end: start + 3 },
    chunkRef: { docId: id, chunkUid: `ck:context:${id}:${name}`, chunkId: `chunk_${id}_${name}`,
      file: doc.virtualPath, range: { start, end: start + 3 } }, symbolHint: { name, kind: 'function' } };
}));
for (const doc of documents) await fs.writeFile(path.join(repoRoot, doc.virtualPath), text);
const tracePath = path.join(dir, 'trace.jsonl'), restore = grantFixtureRepositoryExecution(repoRoot);
let result;
try {
  await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
    result = await collectLspTypes({ rootDir: repoRoot, vfsRoot, documents, targets,
      cmd: process.execPath, args: [path.resolve('tests/fixtures/lsp/stub-lsp-server.js'), '--mode', 'stall-signature-help-two-symbols'],
      providerId: 'clangd', parseSignature: () => null,
      timeoutMs: 5000, retries: 0, sessionPoolingEnabled: false,
      signatureHelpEnabled: false, definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false,
      documentRequestPolicies: {
        'src/exact.cpp': { hoverEnabled: true, hoverMaxPerFile: 1 },
        'src/weak.cpp': { hoverEnabled: false, hoverMaxPerFile: 8 }
      },
      documentUris: { 'src/exact.cpp': pathToFileURL(path.join(repoRoot, 'src/exact.cpp')).href }
    });
  });
} finally { restore(); }
const events = await parseJsonLinesFile(tracePath);
assert.equal(events.filter(event => event.kind === 'request' && event.method === 'textDocument/hover').length, 1,
  'one healthy file may request hover while the weak-context file remains disabled');
const files = result.hoverMetrics.files;
assert.equal(Number(files.find(row => row.virtualPath === 'src/exact.cpp')?.requested || 0), 1);
assert.equal(Number(files.find(row => row.virtualPath === 'src/weak.cpp')?.requested || 0), 0);
await assert.rejects(fs.access(resolveVfsDiskPath({ baseDir: vfsRoot, virtualPath: 'src/exact.cpp' })), { code: 'ENOENT' },
  'an admitted physical source must not silently return to a copied VFS path');
await fs.access(resolveVfsDiskPath({ baseDir: vfsRoot, virtualPath: 'src/weak.cpp' }));
assert.equal(await fs.readFile(path.join(repoRoot, 'src/exact.cpp'), 'utf8'), text, 'LSP overlays must not rewrite the physical source');
assert.ok(events.some(event => event.method === 'shutdown'), 'the real fixture session must complete its shutdown protocol');
console.log('Per-document context limits and physical URI routing use the actual bounded LSP session; fixture server only.');
