import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { chunkWithScheduler } from '../../../src/index/build/file-processor/cpu/scheduler-chunking.js';
import { buildVfsVirtualPath, parseVfsVirtualPathIdentity } from '../../../src/index/tooling/vfs/virtual-path.js';
import { buildSchedulerDegradationReceipt, createSchedulerDegradationQuery } from '../../../src/index/build/tree-sitter-scheduler/degradation.js';
import { captureChunkingCheckpoint, resolveChunkingCheckpoint } from '../../../src/index/build/incremental/stage-reuse.js';
import { LANGUAGE_GRAMMAR_KEYS } from '../../../src/lang/tree-sitter/config.js';

applyTestEnv();
const text = 'export const value = 1;\nexport const other = 2;\n';
const firstEnd = text.indexOf('\n') + 1;
const segment = (start = 0, end = text.length, languageId = 'javascript') => ({
  type: 'embedded', segmentId: `fixture:${start}-${end}`, segmentUid: 'same-content', start, end, languageId
});
const virtual = (containerPath, part = null, ext = '.js') => buildVfsVirtualPath({ containerPath,
  ...(part ? { segmentUid: part.segmentUid, segmentStart: part.start, segmentEnd: part.end, effectiveExt: ext } : {}) });
const input = (relKey, segments, scheduler) => ({ segments, tokenMode: 'code', mustUseTreeSitterScheduler: true,
  treeSitterEnabled: true, treeSitterScheduler: scheduler, treeSitterConfigForMode: {}, treeSitterStrict: true,
  text, ext: '.js', relKey, mode: 'code', lang: { id: 'javascript' }, segmentContext: null,
  lineIndex: null, logLine: null, updateCrashStage: () => {} });

const run = async (relKey, degradedVirtualPaths, { parts = [segment()], failedGrammarKeys = [], typed = false } = {}) => {
  const summary = { failedGrammarKeys, degradedVirtualPaths };
  if (typed) summary.degradation = buildSchedulerDegradationReceipt(summary);
  const owner = createSchedulerDegradationQuery(summary);
  const loaded = [], released = [];
  const scheduler = { index: new Map(), scheduledLanguageIds: new Set(['javascript', 'json']),
    getCrashSummary: () => summary,
    isDegradedVirtualPath: value => degradedVirtualPaths.includes(value),
    ...(typed ? { queryDegradation: owner.query } : {}),
    loadChunksBatch: async paths => paths.map(value => {
      loaded.push(value);
      const part = parts.find(part => virtual(relKey, part, part.languageId === 'json' ? '.json' : '.js') === value);
      assert.ok(part);
      return [{ start: part.start, end: part.end, text: text.slice(part.start, part.end), sentinel: value }];
    }), releaseVirtualPathCaches: value => released.push(value) };
  const result = await chunkWithScheduler(input(relKey, parts, scheduler));
  assert.deepEqual(released, loaded, 'every healthy lookup is released');
  return { ...result, loaded, scheduler };
};

for (const [healthy, failed] of [['src/a.js', 'src/a.json'], ['src/a.json', 'src/a.js'],
  ['src/a.js', 'src/a.js.backup'], ['src/a.js', 'other/src/a.js'], ['src/sub/a.js', 'src/a.js']]) {
  for (const typed of [false, true]) {
    const result = await run(healthy, [virtual(failed)], { failedGrammarKeys: [LANGUAGE_GRAMMAR_KEYS.json], typed });
    assert.equal(result.loaded.length, 1, `${failed} must not suppress ${healthy}`);
    assert.equal(result.chunkingDiagnostics.schedulerDegradedCount, 0);
    assert.equal(result.chunkingDiagnostics.usedHeuristicChunking, false);
    assert.equal(result.chunks[0].sentinel, virtual(healthy, segment()));
  }
}
const parts = [segment(0, firstEnd), segment(firstEnd, text.length)];
for (const typed of [false, true]) {
  const exact = await run('src/a.js', [virtual('src/a.js', parts[0])], { parts, typed });
  assert.deepEqual(exact.loaded, [virtual('src/a.js', parts[1])], 'one segment failure cannot widen to its sibling occurrence');
  assert.equal(exact.chunkingDiagnostics.schedulerDegradedCount, 1);
  assert.equal(exact.chunkingDiagnostics.schedulerDegradation.scopeCounts.segment, 1);
  assert.equal(exact.chunkingDiagnostics.schedulerDegradation.decisions[0].reason, 'exact-segment');
  const checkpoint = captureChunkingCheckpoint(exact.chunks, exact.chunkingDiagnostics, text.length);
  let coldCalls = 0;
  const replay = await resolveChunkingCheckpoint({ cached: checkpoint, textLength: text.length,
    chunker: () => { coldCalls += 1; throw new Error('healthy checkpoint must not re-chunk'); }, input: {} });
  assert.equal(coldCalls, 0); assert.deepEqual(replay.chunks, exact.chunks);
  assert.deepEqual(replay.chunkingDiagnostics, exact.chunkingDiagnostics, 'replay preserves actual scope/cause and counters');
  const container = await run('src/a.js', [virtual('src/a.js')], { parts, typed });
  assert.equal(container.loaded.length, 0); assert.equal(container.chunkingDiagnostics.schedulerDegradedCount, 2);
  assert.equal(container.chunkingDiagnostics.schedulerDegradation.scopeCounts.container, 2);
  const mixed = await run('src/mixed.js', [], { parts: [parts[0], { ...parts[1], languageId: 'json' }],
    failedGrammarKeys: [LANGUAGE_GRAMMAR_KEYS.json], typed });
  assert.deepEqual(mixed.loaded, [virtual('src/mixed.js', parts[0])]);
  assert.equal(mixed.chunkingDiagnostics.schedulerDegradation.scopeCounts.grammar, 1);
}
for (const containerPath of ['src/a#b%25.js', 'src/日本語.js', 'src/É.js']) {
  const path = virtual(containerPath, parts[0]);
  assert.equal(parseVfsVirtualPathIdentity(path).containerPath, containerPath);
  const owner = createSchedulerDegradationQuery({ degradedVirtualPaths: [path] });
  assert.equal(owner.query({ virtualPath: path }).degraded, true);
  assert.equal(owner.query({ virtualPath: virtual(containerPath, parts[1]) }).degraded, false);
}
const canonical = virtual('src/Case.js', parts[0]);
const owner = createSchedulerDegradationQuery({ degradedVirtualPaths: [canonical,
  '.poc-vfs/src/a.js#seg:legacy.js', '.poc-vfs/src/a%2f.js', '.poc-vfs/../outside.js', 'src/a.js'] });
assert.equal(owner.query({ virtualPath: virtual('src/case.js', parts[0]) }).degraded, false, 'VFS identities preserve case');
assert.equal(owner.unknown.length, 4, 'ambiguous historical/raw paths remain explicitly unqualified');
assert.equal(owner.query({ virtualPath: virtual('src/a.js', parts[0]) }).degraded, false);
const future = createSchedulerDegradationQuery({ degradation: { schemaVersion: 99, scopes: [{ scope: 'container', virtualPath: virtual('src/a.js') }] } });
assert.equal(future.unknown[0].reason, 'unsupported-receipt-version');
assert.equal(future.query({ virtualPath: virtual('src/a.js', parts[0]) }).degraded, false);
const futureGrammar = createSchedulerDegradationQuery({ failedGrammarKeys: [LANGUAGE_GRAMMAR_KEYS.json],
  degradation: { schemaVersion: 99, scopes: [] } });
assert.equal(futureGrammar.query({ virtualPath: canonical, grammarKey: LANGUAGE_GRAMMAR_KEYS.json }).degraded, true,
  'an unqualified path receipt cannot revoke an independently explicit failed grammar');
const mutable = { degradation: buildSchedulerDegradationReceipt({ degradedVirtualPaths: [canonical] }) };
const captured = createSchedulerDegradationQuery(mutable);
mutable.degradation.scopes[0].virtualPath = virtual('src/other.js');
assert.equal(captured.query({ virtualPath: canonical }).degraded, true, 'query authority captures its admitted receipt');
const unknown = await run('src/a.js', ['src/a.js']);
assert.equal(unknown.chunkingDiagnostics.schedulerDegradation.unknownReceipts, 1);
assert.equal(unknown.chunkingDiagnostics.schedulerDegradedCount, 0);
assert.equal(unknown.chunks[0].sentinel, virtual('src/a.js', segment()));
console.log('Scheduler degradation preserves exact VFS occurrence/container identity and explicit grammar scope.');
