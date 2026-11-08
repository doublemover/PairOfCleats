import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectNativeIncludeProbes, projectNativeCompileEntry } from '../../../src/index/semantic/native-task-authority.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Portable lexical/search authority only: no compiler, debugger, Linux tooling
// or symlink is run/created. The inert clang file tests argv projection alone;
// full native execution still requires its unchanged sealed ELF owner.
const { dir: repoRoot } = await prepareIsolatedTestCacheDir('native-include-work');
const originalLstat = fs.lstat;
let lstatCalls = 0, intercept = null;
fs.lstat = async function (filename, options) {
  lstatCalls++;
  if (intercept) return intercept(filename, options, originalLstat);
  return originalLstat.call(fs, filename, options);
};
const write = async (name, text) => { const file = path.join(repoRoot, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); return file; };
const main = await write('main.c', ''), header = await write('value.h', '#define VALUE 1\n');
const collect = (textByPath, entries, extra = {}) => collectNativeIncludeProbes({ repoRoot, textByPath, entries,
  present: new Set(textByPath.keys()), ...extra });
try {
  const files = new Map([[main, '#include "value.h"\n'], [header, '#define VALUE 1\n']]);
  const entries = [{ file: main, includeRoots: [], arguments: ['-std=c17'] }];
  const rows = await collect(files, entries);
  assert.deepEqual(rows, [{ path: header, exists: true }]); assert.equal(rows.work.complete, true);
  assert.equal(rows.work.sourceParseCalls, 2); assert.equal(rows.work.sourceBytesScanned, [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0));
  assert.equal(rows.work.uniqueProbes, 1); assert.equal(rows.work.verificationProbes, 1); assert.equal(rows.work.lstatCalls, 2);
  assert.equal(rows.work.retainedBytes, Buffer.byteLength(JSON.stringify(rows)));
  assert.equal(Object.isFrozen(rows.work), true);
  assert.deepEqual(await collect(new Map([...files, [main, '#inc\\\nlude /* retained preprocessing */ "value.h"\r\n']]), entries), rows);
  await assert.rejects(collect(new Map([...files, [main, '#include "value.h>\n']]), entries), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });

  const many = new Map([[header, '#define VALUE 1\n']]), compiles = [];
  for (let index = 0; index < 64; index++) {
    const file = await write(`s${index}.c`, '#include "value.h"\n'); many.set(file, '#include "value.h"\n');
    compiles.push({ file, includeRoots: [], arguments: ['-std=c17'] });
  }
  const other = await write('other.h', '#include "value.h"\n'); many.set(other, '#include "value.h"\n');
  lstatCalls = 0;
  const shared = await collect(many, compiles);
  assert.deepEqual(shared, [{ path: header, exists: true }]);
  assert.equal(shared.work.resolutionRequests, 64 * 65); assert.ok(shared.work.resolutionRequests > 4096);
  assert.equal(shared.work.sourceParseCalls, many.size); assert.equal(shared.work.resolutionContexts, 1);
  assert.equal(shared.work.contextReuseHits, 64 * 65 - 1); assert.equal(shared.work.uniqueProbes, 1);
  assert.equal(lstatCalls, 2, 'one unique observation plus its final recheck, independent of expanded duplicate occurrences');
  const noIncludes = new Map([...many.keys()].map(file => [file, 'int harmless;\n']));
  for (const count of [1, 4, 16]) {
    const result = await collect(noIncludes, compiles.slice(0, count));
    assert.equal(result.work.sourceParseCalls, noIncludes.size);
    assert.equal(result.work.sourceBytesScanned, noIncludes.size * Buffer.byteLength('int harmless;\n'));
    assert.equal(result.work.lstatCalls, 0); assert.equal(result.work.resolutionRequests, 0);
  }

  const a = path.join(repoRoot, 'a'), z = path.join(repoRoot, 'z');
  const aHeader = await write('a/choice.h', '#define FROM_A 1\n'), zHeader = await write('z/choice.h', '#define FROM_Z 1\n');
  const orderFiles = new Map([[main, '#include <choice.h>\n'], [aHeader, '#define FROM_A 1\n'], [zHeader, '#define FROM_Z 1\n']]);
  const ordered = await collect(orderFiles, [{ file: main, includeRoots: [z, a, z] }]);
  assert.deepEqual(ordered, [{ path: zHeader, exists: true }]);
  assert.deepEqual(await collect(orderFiles, [{ file: main, includeRoots: [a, z] }]), [{ path: aHeader, exists: true }]);
  await fs.rm(zHeader); orderFiles.delete(zHeader);
  const absent = await collect(orderFiles, [{ file: main, includeRoots: [z, a] }]);
  assert.deepEqual(absent, [{ path: zHeader, exists: false }, { path: aHeader, exists: true }]);
  await fs.writeFile(zHeader, '#define FROM_Z 1\n'); orderFiles.set(zHeader, '#define FROM_Z 1\n');
  const refreshed = await collect(orderFiles, [{ file: main, includeRoots: [z, a] }]);
  assert.deepEqual(refreshed, [{ path: zHeader, exists: true }], 'a new operation reobserves the earlier negative candidate');

  const localChoice = await write('choice.h', '#define LOCAL 1\n');
  const quoted = new Map([...orderFiles, [main, '#include "choice.h"\n#include <choice.h>\n'], [localChoice, '#define LOCAL 1\n']]);
  assert.deepEqual(await collect(quoted, [{ file: main, includeRoots: [z, a] }]), [
    { path: localChoice, exists: true }, { path: zHeader, exists: true }
  ]);
  // Compile-entry projection itself must preserve first-occurrence argv order.
  const clang = path.join(repoRoot, 'clang'); await fs.writeFile(clang, 'inert projection fixture', { mode: 0o700 });
  const row = { directory: repoRoot, file: 'main.c', arguments: [clang, '-nostdinc', '-ffreestanding', '-std=c17', '-Iz', '-Ia', '-Iz', 'main.c'] };
  const projected = await projectNativeCompileEntry(row, repoRoot);
  assert.deepEqual(projected.includeRoots, [z, a]);
  assert.deepEqual(await collect(orderFiles, [projected]), [{ path: zHeader, exists: true }]);
  await fs.rm(zHeader); orderFiles.delete(zHeader);
  assert.deepEqual(await collect(orderFiles, [projected]), [{ path: zHeader, exists: false }, { path: aHeader, exists: true }]);

  const broad = new Map([[main, Array.from({ length: 33 }, (_, index) => `#include <missing-${index}.h>\n`).join('')]]);
  await assert.rejects(collect(broad, [{ file: main, includeRoots: Array.from({ length: 128 }, (_, index) => path.join(repoRoot, `r${index}`)) }]), error =>
    error.code === 'ERR_SEMANTIC_NATIVE_UNSEALED' && error.includeProbeWork.complete === false
      && error.includeProbeWork.exhaustedBudget === 'unique-probes' && error.includeProbeWork.uniqueProbes === 4096);
  const second = compiles[0].file;
  const contexts = new Map([[main, Array.from({ length: 4096 }, (_, index) => `#include <unique-${index}.h>\n`).join('')], [second, '']]);
  await assert.rejects(collect(contexts, [{ file: main, includeRoots: [], arguments: ['-DA=1'] },
    { file: second, includeRoots: [], arguments: ['-DA=2'] }]), error =>
    error.code === 'ERR_SEMANTIC_NATIVE_UNSEALED' && error.includeProbeWork.exhaustedBudget === 'resolution-contexts');

  const mutable = new Map([...files, [second, '']]), selected = [{ file: main, includeRoots: [] }, { file: second, includeRoots: [] }];
  let mutated = false;
  intercept = async (filename, options, original) => {
    if (!mutated) { mutated = true; mutable.clear(); selected[1].includeRoots.push(path.resolve(repoRoot, '..')); }
    return original.call(fs, filename, options);
  };
  assert.deepEqual(await collect(mutable, selected), rows, 'asynchronous probing retains the already captured source/path/entry snapshot');
  intercept = null;

  let seen = 0;
  intercept = async (filename, options, original) => {
    const stat = await original.call(fs, filename, options);
    if (filename === header && ++seen === 1) await fs.writeFile(header, '#define VALUE_CHANGED 12\n');
    return stat;
  };
  await assert.rejects(collect(files, entries), error => error.code === 'ERR_SEMANTIC_NATIVE_UNSEALED'
    && error.includeProbeWork.complete === false && /changed during construction/u.test(error.message));
  intercept = async (filename, options, original) => {
    const stat = await original.call(fs, filename, options);
    return filename === header ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat;
  };
  await assert.rejects(collect(files, entries), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  const controller = new AbortController();
  intercept = async (filename, options, original) => { const stat = await original.call(fs, filename, options); controller.abort(); return stat; };
  await assert.rejects(collect(files, entries, { signal: controller.signal }), { name: 'AbortError' });
  intercept = null;
  const lexicalAbort = new AbortController(); let reads = 0;
  const signal = { get aborted() { return ++reads >= 4; }, reason: undefined };
  await assert.rejects(collect(new Map([[main, 'int x;\n'.repeat(5000)]]), entries, { signal }), { name: 'AbortError' });
  lexicalAbort.abort();
  await assert.rejects(collect(files, entries, { signal: lexicalAbort.signal }), { name: 'AbortError' });
  let settled = false, codeReads = 0;
  const pending = Object.assign(new Error('pending lstat resource'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => settled });
  Object.defineProperty(pending, 'code', { get() { codeReads++; return 'ENOENT'; } });
  intercept = async () => { throw pending; };
  await assert.rejects(collect(files, entries), error => {
    assert.equal(error.cacheOwnershipReleased(), false); assert.equal(codeReads, 0);
    pending.cacheOwnershipReleased = () => true; assert.equal(error.cacheOwnershipReleased(), false);
    settled = true; assert.equal(error.cacheOwnershipReleased(), true); return true;
  });
} finally { fs.lstat = originalLstat; await fs.rm(repoRoot, { recursive: true, force: true }); }
console.log('Native include authority scans source once, preserves ordered positive/negative witnesses and bounds snapshot-local context/probe work.');
