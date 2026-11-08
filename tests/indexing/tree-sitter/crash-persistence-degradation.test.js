import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSchedulerCrashTracker } from '../../../src/index/build/tree-sitter-scheduler/runner/crash-tracker.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareTestCacheDir('crash-persistence-degradation');
try {
  const blocked = path.join(dir, 'blocked');
  await fs.writeFile(blocked, 'ordinary file prevents local output directory');
  const external = [], messages = [];
  const tracker = createSchedulerCrashTracker({ runtime: { repoCacheRoot: path.join(dir, 'repo'), buildId: 'build' },
    outDir: path.join(dir, 'index'), paths: { baseDir: blocked }, groupByGrammarKey: new Map(),
    crashLogger: { persistForensicBundle: async bundle => { external.push(bundle); } }, log: line => messages.push(line) });
  await tracker.recordFailure({ grammarKey: 'fixture', error: Object.assign(new Error('parse failed'),
    { result: { exitCode: 7, stderr: 'fixture diagnostic' } }) });
  const persistence = await tracker.waitForPersistence();
  assert.equal(persistence.ok, false);
  assert.ok(persistence.failures.some(failure => failure.sink === 'local'));
  assert.ok(persistence.sinks.some(sink => sink.sink === 'durable' && sink.ok));
  assert.equal(external.length, 1, 'a local failure does not suppress an independent sink');
  assert.ok(messages.some(line => line.includes('persistence failed')));
  assert.equal(JSON.parse(await fs.readFile(tracker.getDurableBundlePath(), 'utf8')).events.length, 1);
  assert.equal(tracker.summarize().persistence.ok, false);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('scheduler crash persistence degradation test passed');
