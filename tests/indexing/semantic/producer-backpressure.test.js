#!/usr/bin/env node
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createRecoveryFixture, deferred, semanticBatch, semanticNode } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture(Array.from({ length: 60 }, (_, i) => 'f(' + i + ');').join('\n'));
try {
  const ast = parseJavaScriptAst(fixture.bytes.toString());
  let visited = 0;
  for (const statement of ast.program?.body || ast.body) {
    const expression = statement.expression;
    const value = expression.callee;
    Object.defineProperty(expression, 'callee', { get() { visited += 1; return value; } });
  }
  const entered = deferred(), release = deferred();
  let writes = 0;
  const pending = collectFileSemanticFacts({
    bytes: fixture.bytes, text: fixture.bytes.toString(), ast, language: 'javascript',
    relPath: 'original.js', repositoryNamespace: fixture.root, stagingRoot: fixture.stagingRoot,
    diskAccount: fixture.account, policy: normalizeSemanticConfig({ enabled: true, storage: { batchRows: 4 } }),
    scheduleIo: async (fn) => {
      if (++writes === 1) { entered.resolve(); await release.promise; }
      return fn();
    }
  });
  await entered.promise;
  const stoppedAt = visited;
  assert.ok(stoppedAt < 60, 'the first disk admission must precede the rest of the traversal');
  await setImmediate();
  await setImmediate();
  assert.equal(visited, stoppedAt, 'blocked durable sink must stop producer advancement');
  assert.equal(writes, 1, 'no second disk job may queue behind an unacknowledged batch');
  release.resolve();
  await pending;
  assert.ok(visited >= 60, 'producer resumes and drains the whole source after acknowledgment');

  const retained = fixture.account.used;
  const directories = await fixture.partDirectories();
  const interrupted = new AbortController();
  let cancelWrites = 0;
  await assert.rejects(collectFileSemanticFacts({
    bytes: fixture.bytes, text: fixture.bytes.toString(), ast, language: 'javascript',
    relPath: 'original.js', repositoryNamespace: fixture.root, stagingRoot: fixture.stagingRoot,
    diskAccount: fixture.account, signal: interrupted.signal,
    policy: normalizeSemanticConfig({ enabled: true, storage: { batchRows: 4 } }),
    scheduleIo: async (fn) => { cancelWrites += 1; await fn(); interrupted.abort(); }
  }), { name: 'AbortError' });
  assert.equal(cancelWrites, 1, 'cancellation after a durable flush stops subsequent producer jobs');
  assert.equal(fixture.account.used, retained);
  assert.deepEqual(await fixture.partDirectories(), directories);

  let scheduled = 0;
  const sink = await createSemanticPartitionSink({ ...fixture.options, batchRows: 1, batchBytes: 1024,
    scheduleIo: async fn => { scheduled += 1; return fn(); } });
  const rows = [semanticNode(0, fixture.source.textLength), semanticNode(1, fixture.source.textLength)];
  await assert.rejects(sink.appendBatch(semanticBatch(fixture.partitionId, rows)), /row count/);
  const one = semanticBatch(fixture.partitionId, rows.slice(0, 1));
  await assert.rejects(sink.appendBatch({ ...one, byteCount: one.byteCount + 1 }), /byte limit\/count/);
  assert.equal(scheduled, 0, 'invalid admission cannot write a partial batch');
  await sink.abort();

  const collector = createSemanticCollector({ ast, source: fixture.source, partitionId: fixture.partitionId },
    { batchRows: 4, batchBytes: 1 });
  assert.throws(() => [...collector.batches], { code: 'ERR_SEMANTIC_RECORD_LIMIT' });
  assert.equal(collector.summary.state, 'partial', 'oversized failed producer cannot claim complete syntax');
  const aborted = new AbortController();
  const interruptedCollector = createSemanticCollector({
    ast, source: fixture.source, partitionId: fixture.partitionId, signal: aborted.signal
  }, { batchRows: 4 });
  interruptedCollector.batches.next();
  aborted.abort();
  assert.throws(() => interruptedCollector.batches.next(), { name: 'AbortError' });
  assert.equal(interruptedCollector.summary.state, 'partial', 'cancelled traversal cannot emit complete coverage');
  console.log('semantic durable backpressure and strict producer batch admission passed');
} finally { await fixture.cleanup(); }
