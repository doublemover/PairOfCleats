import assert from 'node:assert/strict';
// Linux ELF qualification only. Portable authority and Windows rejection live
// in native-toolchain-platform; this fixture must remain excluded on Windows.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectNativeTaskInventory, verifyNativeTaskAuthority, nativeTaskInventoryHash,
  NATIVE_DEPENDENCY_KEY, assertNativeTaskAuthority } from '../../../src/index/semantic/native-task-authority.js';
import { resolveNativeExecutable } from '../../../src/index/semantic/native-toolchain.js';
import { prepareNativeTaskExecution } from '../../../src/index/semantic/native-task-execution.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-native-authority-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clang = await resolveNativeExecutable('clang'), clangd = await resolveNativeExecutable('clangd');
const text = '#include "value.h"\nint helper(int x){return x+VALUE;}\nint run(int x){return helper(x);}\n';
const source = { language: 'c', encoding: 'utf8', mapping: null, path: 'main.c', byteHash: hash(text), sourceUnitId: 'su1:' + '1'.repeat(64) };
const toolingConfig = { clangd: { cmd: clangd, compileCommandsDir: root } }, databasePath = path.join(root, 'compile_commands.json');
const entry = { directory: root, file: path.join(root, 'main.c'),
  arguments: [clang, '-nostdinc', '-ffreestanding', '-std=c17', '-Iinclude', '-c', path.join(root, 'main.c')] };
const taskFor = inventory => ({ kind: 'bind', sourceUnits: [source.sourceUnitId], coverageToProduce: ['bindings'],
  dependencies: [{ dependencyKey: NATIVE_DEPENDENCY_KEY, expectedHash: nativeTaskInventoryHash(inventory) }] });
const store = { verifySource: async source => assert.equal(hash(await fs.readFile(path.join(root, source.path))), source.byteHash) };
try {
  await fs.mkdir(path.join(root, 'include'));
  await fs.writeFile(path.join(root, 'main.c'), text);
  await fs.writeFile(path.join(root, 'include', 'value.h'), '#define VALUE 1\n');
  await fs.writeFile(databasePath, JSON.stringify([entry]));
  const inventory = await collectNativeTaskInventory({ repoRoot: root, toolingConfig, sources: [source] });
  const task = taskFor(inventory), target = { nativeInventory: inventory };
  const policy = normalizeSemanticConfig({ enabled: true, languages: ['c'], enrichment: { bindings: 'auto' } });
  const selected = [{ nativeInventory: inventory, task, policy }];
  const runtime = { scheduler: { stats: () => ({ tokens: { mem: { total: 16 } }, adaptive: { memoryPerTokenMb: 64 } }) } };
  const automatic = await prepareNativeTaskExecution({ state: {}, runtime, selected });
  assert.equal(automatic.decision.admitted, false);
  assert.equal(automatic.decision.reason, 'native_process_cost_measurement_unavailable', 'Other tooling reuse never supplies a native process-cost receipt.');
  const explicit = await prepareNativeTaskExecution({ state: {}, runtime: { ...runtime, semanticEnrichmentDrain: {} }, selected });
  assert.equal(explicit.decision.admitted, true);
  assert.equal(explicit.decision.request.bytes, policy.execution.compilerAdmission.maxResidentBytes);
  const small = structuredClone(policy); small.execution.compilerAdmission.maxResidentBytes = 1024 * 1024;
  const refused = await prepareNativeTaskExecution({ state: {}, runtime: { ...runtime, semanticEnrichmentDrain: {} },
    selected: [{ ...selected[0], policy: small }] });
  assert.equal(refused.decision.admitted, false, 'A below-floor user reservation cannot spawn the native process.');
  const verify = () => verifyNativeTaskAuthority({ task, target, repoRoot: root, toolingConfig,
    sources: new Map([[source.sourceUnitId, source]]), store });
  assert.ok(inventory.probes.some(row => row.path === path.join(root, 'value.h') && !row.exists), 'Earlier absent include candidate is retained.');
  assert.ok(inventory.probes.some(row => row.path === path.join(root, 'include', 'value.h') && row.exists));
  assert.ok(inventory.toolchain.files.some(row => row.path === clangd && /^[a-f0-9]{64}$/.test(row.hash)));
  assert.equal((await verify()).complete, true);
  const reject = () => assert.rejects(verify(), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  await fs.writeFile(path.join(root, 'include', 'value.h'), '#define VALUE 2\n'); await reject();
  await fs.writeFile(path.join(root, 'include', 'value.h'), '#define VALUE 1\n');
  await fs.writeFile(path.join(root, 'value.h'), '#define VALUE 3\n'); await reject();
  await fs.rm(path.join(root, 'value.h'));
  await fs.writeFile(databasePath, JSON.stringify([{ ...entry, arguments: [...entry.arguments, '-DVALUE=4'] }])); await reject();
  await fs.writeFile(databasePath, JSON.stringify([entry]));
  await withTemporaryEnv({ LANG: 'poc-inventory-language-change' }, reject);
  await withTemporaryEnv({ LD_AUDIT: '/outside/audit.so' }, reject);
  const alteredToolchain = structuredClone(inventory);
  alteredToolchain.toolchain.files[0].hash = 'f'.repeat(64);
  await assert.rejects(verifyNativeTaskAuthority({ task: taskFor(alteredToolchain), target: { nativeInventory: alteredToolchain },
    repoRoot: root, toolingConfig, sources: new Map([[source.sourceUnitId, source]]), store }), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  assert.throws(() => assertNativeTaskAuthority({ ...task, kind: 'localFlow' }, target), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  assert.throws(() => assertNativeTaskAuthority(task, { nativeInventory: { schemaVersion: 1, kind: 'clangd-c-bindings' } }), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  await fs.writeFile(databasePath, JSON.stringify([{ directory: root, file: entry.file, command: 'clang main.c' }]));
  await assert.rejects(collectNativeTaskInventory({ repoRoot: root, toolingConfig, sources: [source] }), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  await fs.writeFile(databasePath, JSON.stringify([entry]));
  await assert.rejects(collectNativeTaskInventory({ repoRoot: root, toolingConfig, sources: [{ ...source, language: 'rust' }] }), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  await fs.rm(databasePath);
  await assert.rejects(collectNativeTaskInventory({ repoRoot: root, toolingConfig, sources: [source] }), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  console.log('Real clangd/ELF C authority invalidates headers, negative probes, flags, environment and tool hashes; unsupported closure remains blocked');
} finally { await fs.rm(root, { recursive: true, force: true }); }
