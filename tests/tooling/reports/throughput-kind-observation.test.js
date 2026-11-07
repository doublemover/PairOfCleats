import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import { withBenchParitySources } from '../../helpers/bench-parity-sources.js';
import { readRepoMapKindCountsSync } from '../../../tools/reports/show-throughput/analysis.js';
import { createContainedFileResource, getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/throughput-kind-observation/')[1];
assert.ok(['token-and-utf8-boundaries', 'same-stamp-and-owned-counts', 'original-descriptor-settlement'].includes(mode));
if (mode === 'original-descriptor-settlement') {
  const source = await fs.readFile(new URL('../../../tools/reports/show-throughput/analysis.js', import.meta.url), 'utf8');
  const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .flatMap(node => (node.type === 'ExportNamedDeclaration' ? node.declaration : node)?.declarations ?? []);
  const selected = ['REPO_MAP_KIND_LIMITS', 'createRepoMapKindCounter', 'readRepoMapKindCountsSync'].map(name => {
    const declaration = declarations.find(row => row.id.name === name); assert.ok(declaration, 'original kind owner required: ' + name);
    return 'const ' + source.slice(declaration.start, declaration.end) + ';';
  }).join('\n');
  const create = vm.runInThisContext('"use strict";\n(({fs, createContainedFileResource, observeStorageResource}) => {\n'
    + selected + '\nreturn readRepoMapKindCountsSync; })');
  const contains = (error, target, seen = new Set()) => {
    if (error === target) return true;
    if (!error || typeof error !== 'object' || seen.has(error)) return false; seen.add(error);
    return contains(Object.getOwnPropertyDescriptor(error, 'cause')?.value, target, seen)
      || (Object.getOwnPropertyDescriptor(error, 'errors')?.value ?? []).some(row => contains(row, target, seen));
  };
  for (const kind of ['read-pending', 'close-rejected']) {
    const bytes = Buffer.from('"kind":"functiondeclaration"'), trace = { reads: 0, closes: 0, settled: false, codeReads: 0 };
    const original = new Error('original explicit synchronous ' + kind);
    Object.defineProperties(original, { code: { get() { trace.codeReads++; throw new Error('unsafe kind diagnostic'); } },
      ...(kind === 'read-pending' ? { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => trace.settled } } : {}) }); Object.freeze(original);
    const fakeFs = { openSync: () => 37, fstatSync: () => ({ isFile: () => true, size: BigInt(bytes.length), dev: 1n, ino: 2n, mtimeNs: 1n, ctimeNs: 1n }),
      readSync: (_fd, target, offset, length, position) => {
        trace.reads++; if (kind === 'read-pending') throw original;
        bytes.copy(target, offset, position, position + length); return length;
      }, closeSync: () => { trace.closes++; if (kind === 'close-rejected') throw original; } };
    const read = create({ fs: fakeFs, createContainedFileResource, observeStorageResource });
    let failure;
    assert.throws(() => read('explicit-owner-model'), error => { failure = error; return contains(error, original); });
    assert.equal(trace.reads, 1); assert.equal(trace.codeReads, 0);
    assert.equal(trace.closes, kind === 'read-pending' ? 0 : 1);
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(session.isSettled(), false);
    if (kind === 'read-pending') {
      trace.settled = true; assert.equal(session.releaseAfterCloseSync().settled, true); assert.equal(trace.closes, 1);
    } else {
      assert.throws(() => session.releaseAfterCloseSync()); assert.equal(trace.closes, 1, 'an unknown sync close cannot be replayed by fd number');
    }
    assert.equal(trace.reads, 1, 'recovery cannot repeat parsing');
  }
} else await withBenchParitySources(async source => {
  const file = path.join(source.root, 'repo_map.json');
  if (mode === 'token-and-utf8-boundaries') {
    const marker = '"kind":"functiondeclaration"', oldCut = 1024 * 1024 - 256;
    for (const padding of [oldCut - marker.length + 1, 65536 - 3, 65536 - marker.length + 2]) {
      await fs.writeFile(file, 'x'.repeat(padding) + marker + 'y'.repeat(1024));
      assert.equal(readRepoMapKindCountsSync(file)?.functiondeclaration, 1, 'a transport cut must not erase a compact kind token');
    }
    await fs.writeFile(file, 'x'.repeat(65536 - Buffer.byteLength('"kind":"') - 1) + '"kind":"λclass"');
    assert.equal(readRepoMapKindCountsSync(file)?.['λclass'], 1, 'UTF-8 is decoded across native read cuts');
    const overlap = '"kind"kind":"recovered" "kind":""kind":"alsoRecovered"';
    await fs.writeFile(file, overlap);
    const expected = {}; for (const match of overlap.matchAll(/"kind":"([^"]+)"/g)) expected[match[1].trim()] = (expected[match[1].trim()] || 0) + 1;
    assert.deepEqual(readRepoMapKindCountsSync(file), expected, 'compact-marker matching retains nonoverlap semantics');
    await fs.writeFile(file, Buffer.from([0xff, 10])); assert.equal(readRepoMapKindCountsSync(file), null);
    await fs.writeFile(file, '"kind":"unfinished'); assert.equal(readRepoMapKindCountsSync(file), null);
  } else {
    const firstBytes = '"kind":"classdeclaration"', secondBytes = '"kind":"otherdeclaration"', stamp = new Date('2026-11-01T00:00:00.000Z');
    assert.equal(Buffer.byteLength(firstBytes), Buffer.byteLength(secondBytes));
    await fs.writeFile(file, firstBytes); await fs.utimes(file, stamp, stamp);
    const first = readRepoMapKindCountsSync(file); assert.equal(first.classdeclaration, 1); first.classdeclaration = 999; first.poisoned = 1;
    assert.deepEqual(readRepoMapKindCountsSync(file), { classdeclaration: 1 }, 'returned counts cannot poison later observations');
    await fs.writeFile(file, secondBytes); await fs.utimes(file, stamp, stamp);
    assert.deepEqual(readRepoMapKindCountsSync(file), { otherdeclaration: 1 }, 'same mtime/length cannot authorize stale reuse');
    await fs.writeFile(file, '"kind":"__proto__" "kind":"constructor"');
    const counts = readRepoMapKindCountsSync(file);
    assert.equal(Object.getOwnPropertyDescriptor(counts, '__proto__').value, 1);
    assert.equal(Object.getOwnPropertyDescriptor(counts, 'constructor').value, 1); assert.equal(Object.getPrototypeOf(counts), Object.prototype);
  }
});
console.log('Kind observations retain boundary tokens, fresh source bytes and original descriptor settlement.');
