#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';
import { openPublishedSymbolicTypeStore } from '../../../src/semantic/symbolic-type-store.js';
import { isRequiredToolingComputationError } from '../../../src/index/tooling/required-computation.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-symbolic-build-'));
const repo = path.join(temporary, 'repo');
try {
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, 'types.ts'), 'export type Bit = "a" | "b";\nexport type Product = `'
    + '${Bit}'.repeat(72) + '`;\n');
  await fs.writeFile(path.join(repo, 'input.ts'), 'import type { Product } from "./types";\n'
    + 'export function echo(value: Product): Product { return value; }\n');
  await fs.writeFile(path.join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    strict: true, types: [], target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler'
  }, files: ['types.ts', 'input.ts'] }));
  applyTestEnv({ cacheRoot: path.join(temporary, 'cache'), embeddings: 'stub', testConfig: {
    indexing: { workerPool: { enabled: false }, semantic: { enabled: false }, embeddings: { enabled: false },
      typeInference: true, typeInferenceCrossFile: true, riskAnalysis: false, riskAnalysisCrossFile: false,
      treeSitter: { enabled: false } },
    tooling: { enabledTools: ['typescript'], autoEnableOnDetect: true, timeoutMs: 10000,
      typescript: { typeRepresentation: 'symbolic' }, lsp: { enabled: false } }
  } });
  await buildIndex(repo, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
  const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'symbolic_type_manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'complete');
  assert.equal(manifest.graphs.length, 1);
  const chunks = await loadChunkMeta(indexDir, { strict: true });
  const echo = chunks.find(chunk => chunk.name === 'echo');
  assert.ok(echo, 'actual parser target must survive publication');
  const expressions = echo.metaV2?.types?.expressions || echo.docmeta?.typeExpressions;
  assert.equal(expressions?.interpretation, 'declared-type-denotation');
  assert.deepEqual(echo.metaV2.types.expressions, echo.docmeta.typeExpressions);
  const store = await openPublishedSymbolicTypeStore({ indexDir, repoRoot: repo, generation: manifest.generation });
  assert.equal((await store.query({ ref: expressions.returnType, operation: 'membership', value: 'a'.repeat(72) })).contains, true);
  assert.equal((await store.query({ ref: expressions.returnType, operation: 'membership', value: 'a'.repeat(71) + 'z' })).contains, false);
  assert.equal((await store.query({ ref: expressions.returnType, operation: 'classify' })).cardinality, 'many');
  // Required unsupported work in a later build must not replace the usable generation.
  await fs.writeFile(path.join(repo, 'input.ts'), 'export function unsupported(value: number): number { return value; }\n');
  await assert.rejects(buildIndex(repo, { mode: 'code', stage: 'stage2', incremental: true,
    'stub-embeddings': true, 'scm-provider': 'none' }), isRequiredToolingComputationError);
  assert.equal(getIndexDir(repo, 'code', loadUserConfig(repo)), indexDir,
    'failed required analysis cannot advance the published generation');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(indexDir, 'symbolic_type_manifest.json'), 'utf8')), manifest);
  assert.equal((await store.query({ ref: expressions.returnType, operation: 'membership', value: 'a'.repeat(72) })).contains, true);

  console.log('two-file source → owned compiler frontend → shared artifact → published generation → exact symbolic query');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
