import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { buildSingleSymbolInputs } from '../../helpers/lsp-provider-fixture.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { canonicalizeTypeText } from '../../../src/shared/type-normalization.js';

const cases = {
  python: { mode: 'python-comparison-default', name: 'greet', ext: '.py',
    text: 'def greet(ok: bool = 1 < 2, mask: int = 1 << 2) -> bool:\n  return ok\n',
    paramTypes: { ok: 'bool', mask: 'int' }, returnType: 'bool' },
  go: { mode: 'go-grouped-channel', name: 'Read', ext: '.go',
    text: 'package sample\nfunc Read(first, second <-chan string, timeout int) error { return nil }\n',
    paramTypes: { first: '<-chan string', second: '<-chan string', timeout: 'int' }, returnType: 'error' },
  rust: { mode: 'rust-lifetime-tuple', name: 'borrow', ext: '.rs',
    text: "fn borrow<'a>(text: &'a str, count: u32) -> (usize, usize) { (text.len(), count as usize) }\n",
    paramTypes: { text: "&'a str", count: 'u32' }, returnType: '(usize, usize)' }
};
const languageId = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(Object.hasOwn(cases, languageId), 'run a discovered per-language case');
const spec = cases[languageId], { dir } = await prepareIsolatedTestCacheDir('signature-boundary-provider');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const restore = grantFixtureRepositoryExecution(dir);
try {
  const virtualPath = 'source' + spec.ext;
  await fs.writeFile(path.join(dir, virtualPath), spec.text);
  const input = buildSingleSymbolInputs({ scenarioName: spec.mode, virtualPath, text: spec.text,
    languageId, effectiveExt: spec.ext, symbolName: spec.name });
  const result = await collectLspTypes({ rootDir: dir, vfsRoot: dir,
    documents: input.documents, targets: input.targets,
    cmd: process.execPath, args: [path.resolve('tests/fixtures/lsp/stub-lsp-server.js'), '--mode', spec.mode],
    providerId: 'fixture-' + languageId, parseSignature: parseGenericSignature });
  const payload = result.byChunkUid[input.chunkUid]?.payload;
  assert.ok(payload, JSON.stringify(result.checks));
  assert.equal(payload.returnType, spec.returnType);
  for (const [name, type] of Object.entries(spec.paramTypes)) assert.equal(payload.paramTypes?.[name]?.[0]?.type,
    canonicalizeTypeText(type, { languageId }).displayText, name);
  assert.ok(result.runtime.requests.requests > 0, 'the real LSP callback contributes parsed provider results');
} finally {
  await cleanupLspTestRuntime({ reason: 'signature_boundary_provider_complete', strict: true });
  restore();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`${languageId} boundary signature survives the real LSP callback and production parser dispatch`);
