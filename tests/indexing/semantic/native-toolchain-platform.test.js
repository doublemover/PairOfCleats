import assert from 'node:assert/strict';
import { collectNativeToolchainFiles } from '../../../src/index/semantic/native-toolchain.js';
import { assertNativeTaskAuthority, nativeTaskInventoryHash, NATIVE_DEPENDENCY_KEY }
  from '../../../src/index/semantic/native-task-authority.js';

if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
  await assert.rejects(collectNativeToolchainFiles({ executables: [process.execPath] }), {
    code: 'ERR_SEMANTIC_NATIVE_UNSEALED', message: 'Native sealed toolchain platform is unsupported.'
  }, 'Windows/macOS executable imports cannot establish Linux ELF authority');
}

// Structural task authority is portable. Actual ELF sealing and clangd output
// belong to native-task-authority and native-deferred-production on Linux.
const sourceUnitId = 'su1:' + '1'.repeat(64);
const inventory = { schemaVersion: 1, kind: 'clangd-c-bindings',
  sources: [{ sourceUnitId, path: 'main.c', byteHash: '2'.repeat(64) }] };
const task = { kind: 'bind', sourceUnits: [sourceUnitId], coverageToProduce: ['bindings'],
  dependencies: [{ dependencyKey: NATIVE_DEPENDENCY_KEY, expectedHash: nativeTaskInventoryHash(inventory) }] };
const target = { nativeInventory: inventory };
assert.doesNotThrow(() => assertNativeTaskAuthority(task, target));
for (const changed of [
  { ...task, kind: 'localFlow' }, { ...task, coverageToProduce: ['bindings', 'localFlow'] },
  { ...task, sourceUnits: ['su1:' + '3'.repeat(64)] },
  { ...task, dependencies: [{ ...task.dependencies[0], expectedHash: '4'.repeat(64) }] }
]) assert.throws(() => assertNativeTaskAuthority(changed, target), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
assert.throws(() => assertNativeTaskAuthority(task, { ...target, compilerInventory: {} }),
  { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
assert.throws(() => assertNativeTaskAuthority(task, {}), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
console.log(`Native platform rejection and portable task authority passed (${process.platform}/${process.arch}); ELF positives remain Linux-owned`);
