import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getIndexDir, getToolingConfig, loadUserConfig } from '../../src/shared/dict-utils.js';
import { compilerInventoryHash, COMPILER_DEPENDENCY_KEY } from '../../src/index/semantic/compiler-dependencies.js';
import { semanticHash } from '../../src/index/semantic/identity.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { applyTestEnv } from './test-env.js';
import { createFastIndexingTestConfig } from './fast-indexing-config.js';
import { prepareIsolatedTestCacheDir } from './test-cache.js';
import { installPublicationBoundaryDiagnostics } from './publication-boundary-diagnostics.js';

export const PHASE_COMPILER_CONFIG = JSON.stringify({ compilerOptions: { types: [], lib: ['ES5'], target: 'ES2022' }, include: ['*.ts'] });
export const PHASE_COMPILER_REVOKED_CONFIG = JSON.stringify({ compilerOptions: { types: [], strict: true } });
const sources = Object.freeze({
  'input.ts': 'export function scale(x:number) { return x*2; } export function run() { const payload={value:scale(3)}; return payload.value; }',
  'input.vue': '<template>Hello</template><script lang="ts">export function wrap(x:number) { return x+1; } const result=wrap(4);</script>'
});
const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

/** Both bounded fixtures retain the exact original sources, real ES5 library,
 * deferred phases and normal Stage2 builder. Only their assertions partition. */
export const runDeferredPhaseFixture = async (name, operation) => {
  const { dir: temp } = await prepareIsolatedTestCacheDir(name), diagnostics = installPublicationBoundaryDiagnostics();
  let workError, workFailed = false;
  try {
    const repoRoot = path.join(temp, 'repo'); await fs.mkdir(repoRoot);
    await fs.writeFile(path.join(repoRoot, 'tsconfig.json'), PHASE_COMPILER_CONFIG);
    for (const [filename, text] of Object.entries(sources)) await fs.writeFile(path.join(repoRoot, filename), text);
    applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: createFastIndexingTestConfig({ threads: 1, indexing: {
      workerPool: { enabled: false }, semantic: { enabled: true, profile: 'rich', enrichment: { bindings: 'deferred', localFlow: 'deferred', crossFileFlow: 'deferred' } },
      embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false }
    } }) });
    const { buildIndex } = await import('../../src/integrations/core/index.js');
    const { runSemanticEnrichmentService } = await import('../../src/semantic/enrichment.js');
    const initialStart = performance.now();
    await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', threads: 1, incremental: false, 'stub-embeddings': true, 'scm-provider': 'none' });
    console.log(JSON.stringify({ phase: 'deferred-source-publication', elapsedMs: performance.now() - initialStart }));
    const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
    const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'semantic_manifest.json'), 'utf8'));
    assert.equal(manifest.completedTasks.length, 0);
    const request = { schemaVersion: 1, repoRoot, generation: manifest.generation,
      limits: { maxTasks: 32, maxBytes: 65536, maxMs: 30000, drainMaxMs: 30000 } };
    await operation({ repoRoot, indexDir, manifest, request, runSemanticEnrichmentService });
  } catch (error) { workError = error; workFailed = true; }
  finally {
    diagnostics.finish(); const cleanupAt = performance.now();
    console.log(JSON.stringify({ phase: 'fixture-owned-root-cleanup-start' }));
    try {
      if (workFailed) observeStorageResource(workError, { phase: 'phase-drain-fixture-cleanup' }).requireSettled();
      assert.ok(path.relative(process.cwd(), temp).startsWith('.tmp' + path.sep));
      await fs.rm(temp, { recursive: true, force: true });
      console.log(JSON.stringify({ phase: 'fixture-owned-root-cleanup-settled', elapsedMs: performance.now() - cleanupAt }));
    } catch (cleanupError) {
      workError = workFailed ? addStorageFailureContext(workError, {}, cleanupError, { secondaryPresent: true }) : cleanupError;
      workFailed = true;
    }
  }
  if (workFailed) throw workError;
};

/** Read registered, hashed task targets through the original service admission
 * owner. These are the exact dependency verifier inputs, with no generation or
 * path normalization removed from the compiler witness before comparison. */
export const readPhaseCompilerWitness = async ({ repoRoot, indexDir, generation }) => {
  const { openEnrichmentInventory, verifyEnrichmentTask, createEnrichmentBudget } = await import('../../src/semantic/enrichment-inventory.js');
  const userConfig = loadUserConfig(repoRoot), budget = createEnrichmentBudget(30000);
  const inventory = await openEnrichmentInventory({ repoRoot, userConfig, generation, indexDir, budget });
  const tasks = [...inventory.tasks.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  assert.deepEqual(tasks.map(row => row.kind), ['bind', 'crossFileFlow', 'localFlow']);
  let compilerInventory;
  for (const task of tasks) {
    const target = await verifyEnrichmentTask({ inventory, task, budget });
    assert.ok(target.compilerInventory);
    if (compilerInventory) assert.deepEqual(target.compilerInventory, compilerInventory);
    else compilerInventory = target.compilerInventory;
    assert.deepEqual(task.dependencies, [{ dependencyKey: COMPILER_DEPENDENCY_KEY, expectedHash: compilerInventoryHash(compilerInventory) }]);
  }
  assert.equal(compilerInventory.groups.length, 1); assert.equal(compilerInventory.virtualInputs.length, 2);
  assert.deepEqual(compilerInventory.virtualInputs.map(row => pathKey(path.resolve(repoRoot, row.containerPath))).sort(),
    ['input.ts', 'input.vue'].map(filename => pathKey(path.join(repoRoot, filename))).sort());
  assert.ok(compilerInventory.virtualInputs.every(row => row.mappingQuality === 'exact'));
  const configurations = new Set(compilerInventory.groups.map(row => pathKey(row.configPath)));
  const programFiles = compilerInventory.closure.files.filter(row => !configurations.has(pathKey(row.path)));
  const embedded = compilerInventory.virtualInputs.find(row => pathKey(path.resolve(repoRoot, row.containerPath)) === pathKey(path.join(repoRoot, 'input.vue')));
  assert.deepEqual(programFiles.map(row => pathKey(row.path)).sort(), [path.join(repoRoot, 'input.ts'), path.resolve(repoRoot, embedded.virtualPath),
    ...['lib.es5.d.ts', 'lib.decorators.d.ts', 'lib.decorators.legacy.d.ts'].map(filename => path.join(path.dirname(compilerInventory.compilerFile), filename))].map(pathKey).sort(),
  'Both fixtures retain the same five actual compiler sources and installed standard libraries.');
  assert.equal(compilerInventory.closure.totalFiles, 6);
  const configObservation = compilerInventory.observations.find(row => row.method === 'readFile' && pathKey(row.args[0]) === pathKey(path.join(repoRoot, 'tsconfig.json')));
  assert.equal(configObservation.result, createHash('sha256').update(PHASE_COMPILER_CONFIG).digest('hex'));
  const verifierInput = { inventory: compilerInventory, repoRoot, toolingConfig: getToolingConfig(repoRoot, userConfig) };
  return { inventory, verifierInput, programSourceCount: programFiles.length, authorityHash: compilerInventoryHash(compilerInventory),
    verifierInputHash: semanticHash('fixture.semantic.compiler-verifier-input.v1', verifierInput) };
};
