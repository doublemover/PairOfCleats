import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { PerformanceObserver } from 'node:perf_hooks';
import { createRepoMapIterator } from '../../src/index/build/artifacts/writers/repo-map.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('member-join-work-consumer/')[1];
assert.ok(['durable', 'mixed', 'measure'].includes(selected));
const key = Symbol.for('poc.test.map-member-work');
const work = { candidates: 0, legacyArrays: 0, durableLookups: 0 };
globalThis[key] = work;
const hook = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/src/map/build-map/members.js')) return loaded;
  let source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  const counter = 'globalThis[Symbol.for("poc.test.map-member-work")]';
  source = source.replace('const compatible = (member, entry) => (',
    `const compatible = (member, entry) => (${counter}.candidates++,`);
  source = source.replace('memberByChunkUid.get(uid)', `(${counter}.durableLookups++, memberByChunkUid.get(uid))`);
  source = source.replace(/const candidates = (\[\.\.\.[\s\S]*?\.filter\(candidate => compatible\(candidate, entry\)\));/u,
    `const candidates = (${counter}.legacyArrays++, $1);`);
  return { ...loaded, source };
} });
let gcCount = 0, gcDurationMs = 0;
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) { gcCount++; gcDurationMs += entry.duration; }
});
observer.observe({ entryTypes: ['gc'] });
try {
  const { buildMapMembers } = await import('../../src/map/build-map/members.js');
  const fixture = count => {
    const chunks = Array.from({ length: count }, (_, id) => ({ id, file: 'src/generated.js', name: 'overload',
      kind: 'function', startLine: id + 1, endLine: id + 1, start: id * 20, end: id * 20 + 19,
      metaV2: { chunkUid: `chunk:${id}`, symbol: { symbolId: `symbol:${id}` },
        virtualPath: `src/generated.js#origin-${id % 2}`, signature: `overload(${id})` } }));
    const repoMap = [...createRepoMapIterator({ chunks,
      fileRelations: new Map([['src/generated.js', { exports: ['overload'] }]]) })()];
    assert.equal(repoMap.length, count);
    return { chunks, repoMap };
  };
  const build = (input, repoMap = input.repoMap) => {
    const warnings = [];
    const result = buildMapMembers({ chunkMeta: input.chunks, repoMap, fileMeta: [], fileRelations: [],
      intern: value => value, strict: true, warnings });
    return { ...result, warnings };
  };
  const project = value => ({ members: [...value.memberById.values()], aliases: [...value.aliasById],
    files: [...value.membersByFile.keys()], summary: value.identitySummary, warnings: value.warnings });
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const reset = () => { work.candidates = 0; work.legacyArrays = 0; work.durableLookups = 0; };
  const samples = [];
  for (const count of [1, 64, 512]) {
    const input = fixture(count);
    reset();
    const value = build(input);
    assert.equal(value.memberById.size, count);
    assert.deepEqual(value.identitySummary, { ambiguous: 0, unresolved: 0, complete: true });
    assert.deepEqual(value.warnings, []);
    for (let id = 0; id < count; id++) {
      const member = value.memberById.get(`symbol:${id}`);
      assert.equal(member.file, 'src/generated.js'); assert.equal(member.name, 'overload');
      assert.equal(member.signature, `overload(${id})`); assert.equal(member.exported, true);
      assert.deepEqual(member.range, { startLine: id + 1, endLine: id + 1 });
      assert.equal(member.virtualPath, `src/generated.js#origin-${id % 2}`);
      assert.equal(value.aliasById.get(`chunk:${id}`), `symbol:${id}`);
    }
    if (selected !== 'measure') {
      assert.equal(work.durableLookups, count);
      assert.equal(work.candidates, 0, 'durable identity performs no legacy candidate visits');
      assert.equal(work.legacyArrays, 0, 'durable identity allocates no legacy candidate arrays');
    }
    if (selected === 'mixed') {
      const legacy = input.repoMap.slice(0, Math.min(2, count)).map(({ chunkUid, symbolId, ...entry }) => entry);
      const combined = build(input, [...input.repoMap, ...legacy]);
      assert.deepEqual(project(combined), project(value), 'legacy aliases cannot duplicate or change the canonical members');
      if (count > 1) {
        const ambiguous = build(input, [...input.repoMap, { file: 'src/generated.js', name: 'overload', exported: true }]);
        assert.equal(ambiguous.identitySummary.ambiguous, 1);
        assert.deepEqual([...ambiguous.memberById.values()], [...value.memberById.values()]);
        assert.equal(ambiguous.aliasById.get('src/generated.js::overload'), null);
        assert.equal(ambiguous.warnings.length, 1);
        assert.throws(() => build(input, [{ ...input.repoMap[0], symbolId: 'symbol:1' }]), /Conflicting/);
        assert.throws(() => build(input, [{ ...input.repoMap[0], virtualPath: 'foreign-origin' }]), /disagrees/);
      }
      const unresolved = build(input, [...input.repoMap, { ...input.repoMap[0], chunkUid: 'missing', symbolId: 'missing' }]);
      assert.equal(unresolved.identitySummary.unresolved, 1);
      assert.deepEqual([...unresolved.memberById.values()], [...value.memberById.values()]);
    }
    if (selected === 'measure') {
      const expected = digest(project(value)), sourceIdentity = digest(input);
      for (let i = 0; i < 3; i++) assert.equal(digest(project(build(input))), expected);
      for (let trial = 0; trial < 3; trial++) {
        reset(); const before = process.memoryUsage(), start = performance.now();
        let operations = 0, observedHeapMax = before.heapUsed, last;
        do {
          last = build(input); operations++;
          observedHeapMax = Math.max(observedHeapMax, process.memoryUsage().heapUsed);
        } while (performance.now() - start < 60);
        const elapsedMs = performance.now() - start;
        assert.equal(digest(project(last)), expected);
        samples.push({ count, trial, operations, elapsedMs, millisecondsPerBuild: elapsedMs / operations,
          ...work, heapUsedBefore: before.heapUsed, heapUsedAfter: process.memoryUsage().heapUsed,
          observedHeapMax, sourceIdentity, outputIdentity: expected });
      }
    }
  }
  if (selected === 'measure') {
    await new Promise(resolve => setImmediate(resolve));
    console.log(JSON.stringify({ kind: 'serial-map-member-work', samples, gcCount, gcDurationMs,
      memoryBasis: 'sampled V8 heap after each completed build; not peak RSS or production capacity' }));
  }
} finally { observer.disconnect(); hook.deregister(); delete globalThis[key]; }
console.log(`Real repo-map producer/member consumer preserves ${selected} identities and bounded preparation work.`);
