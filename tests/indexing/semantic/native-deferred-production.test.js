import assert from 'node:assert/strict';
// Linux ELF/clangd qualification only; native-toolchain-platform covers explicit
// Windows rejection without claiming Windows executables satisfy this contract.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { runSemanticEnrichmentService } from '../../../src/semantic/enrichment.js';
import { resolveNativeExecutable } from '../../../src/index/semantic/native-toolchain.js';
import { NATIVE_DEPENDENCY_KEY } from '../../../src/index/semantic/native-task-authority.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { skipIf } from '../../helpers/skip.js';

skipIf(process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch),
  'Linux ELF/clangd positive qualification; native-toolchain-platform owns Windows/macOS rejection and portable authority.');

// Actual installed tools are required. Missing native setup fails qualification;
// it cannot silently substitute a fake LSP server or count a skip as closure.
const clang = await resolveNativeExecutable('clang'), clangd = await resolveNativeExecutable('clangd');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-native-deferred-')), repoRoot = path.join(temp, 'repo');
await fs.mkdir(repoRoot);
try {
  const file = path.join(repoRoot, 'main.c');
  await fs.writeFile(file, 'int helper(int x) { return x+1; }\nint run(int x) { return helper(x); }\n');
  await fs.writeFile(path.join(repoRoot, 'compile_commands.json'), JSON.stringify([{ directory: repoRoot, file,
    arguments: [clang, '-nostdinc', '-ffreestanding', '-std=c17', '-c', file] }]));
  applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
    indexing: { workerPool: { enabled: false }, semantic: { enabled: true, languages: ['c'],
      enrichment: { bindings: 'deferred', localFlow: 'off', crossFileFlow: 'off' } }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: true } },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: true }, clangd: { enabled: true, cmd: clangd,
      compileCommandsDir: repoRoot, requireCompilationDatabase: true }, typescript: { enabled: false } }
  } });
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: false, 'stub-embeddings': true, 'scm-provider': 'none' });
  const userConfig = loadUserConfig(repoRoot), coldDir = getIndexDir(repoRoot, 'code', userConfig);
  const cold = await openPublishedSemanticStore({ repoRoot, indexDir: coldDir });
  assert.equal(cold.manifest.completedTasks.length, 0, 'Deferred indexing does not execute clangd.');
  const tasks = [];
  for (const partition of cold.manifest.partitions) for await (const row of cold.store.iterateRows(partition.partitionId, 'semantic_frontier')) tasks.push(row);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].kind, 'bind');
  assert.equal(tasks[0].dependencies[0].dependencyKey, NATIVE_DEPENDENCY_KEY);
  const descriptor = JSON.parse(await fs.readFile(path.join(coldDir, 'semantic', tasks[0].targetsRef), 'utf8'));
  assert.equal(descriptor.compilerInventory, undefined, 'A native binding never borrows a TypeScript closure.');
  assert.ok(descriptor.nativeInventory.toolchain.files.some(row => row.path === clangd));
  const request = { schemaVersion: 1, repoRoot, generation: cold.manifest.generation,
    limits: { maxTasks: 32, maxBytes: 65536, maxMs: 30000, drainMaxMs: 30000 } };
  const plan = await runSemanticEnrichmentService({ request });
  assert.equal(plan.tasks[0].executable, true);
  const result = await runSemanticEnrichmentService({ request: { ...request, action: 'drain', taskIds: [tasks[0].taskId] } });
  assert.equal(result.status, 'published'); assert.equal(result.lineage.length, 1);
  const freshDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const fresh = await openPublishedSemanticStore({ repoRoot, indexDir: freshDir, generation: result.publishedGeneration });
  assert.equal(fresh.manifest.completedTasks.length, 1, 'Real provider output is acknowledged only after publication.');
  const bindings = [], edges = [], coverage = [];
  for (const partition of fresh.manifest.partitions) {
    for await (const row of fresh.store.iterateRows(partition.partitionId, 'semantic_records')) if (row.kind === 'binding') bindings.push(row);
    for await (const row of fresh.store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    coverage.push(...await fresh.store.getCoverage([partition.partitionId]));
  }
  assert.ok(bindings.some(row => row.data.status === 'resolved'), 'Actual clangd resolves a retained C declaration.');
  assert.ok(edges.some(row => row.kind === 'callTarget' && row.certainty === 'exact-static'), 'Real definition evidence joins the C invocation.');
  assert.ok(coverage.some(row => row.phase === 'bindings' && ['complete', 'partial'].includes(row.state)));
  assert.ok(!coverage.some(row => row.phase === 'crossFileFlow' && row.state === 'complete'), 'Provider bindings do not imply native value propagation.');
  const control = path.join(getRepoCacheRoot(repoRoot, userConfig), 'semantic-frontier', 'control.sqlite');
  for (const suffix of ['', '-wal', '-shm']) await fs.rm(control + suffix, { force: true });
  const completedTaskIds = fresh.manifest.completedTasks.map(row => row.taskId);
  const recovered = await runSemanticEnrichmentService({ request: { ...request, action: 'enqueue',
    generation: fresh.manifest.generation, taskIds: completedTaskIds } });
  assert.equal(recovered.tasks.length, completedTaskIds.length);
  assert.ok(recovered.tasks.every(row => row.state === 'completed'), 'Missing control storage reconstructs actual published native completion.');
  console.log(JSON.stringify({ qualification: 'actual-sealed-clangd-c-bindings', sourceGeneration: cold.manifest.generation,
    publishedGeneration: fresh.manifest.generation, sourceTaskId: tasks[0].taskId, lineage: result.lineage,
    dependency: tasks[0].dependencies[0], sources: descriptor.nativeInventory.sources, launch: descriptor.nativeInventory.launch,
    toolchainFiles: descriptor.nativeInventory.toolchain.files.length, toolchainBytes: descriptor.nativeInventory.toolchain.totalBytes,
    executableIdentities: descriptor.nativeInventory.toolchain.files.filter(row => [clang, clangd].includes(row.path)),
    residentReservationBytes: normalizeSemanticConfig(userConfig.indexing.semantic).execution.compilerAdmission.maxResidentBytes,
    reservationBasis: 'policy-ceiling-not-hard-memory-limit', nativeProcessRssMeasured: false,
    limits: ['direct-c-bindings-only', 'header-only-tasks-unsupported', 'native-value-flow-unproved', 'other-native-provider-authority-unsealed'] }));
  console.log('Actual sealed C/clangd deferred publication, exact source joins and control reconstruction passed');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
