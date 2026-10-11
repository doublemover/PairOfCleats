import assert from 'node:assert/strict';
import { createCrashStageUpdater, createFileProcessorCrashStageUpdater } from '../../../src/index/build/file-processor/crash-stage.js';
import { collectStage1StalledFiles } from '../../../src/index/build/indexer/steps/process-files/stall-diagnostics.js';

const stages = [];
const disabled = { enabled: false, updateFile: () => { throw new Error('disabled logger'); } };
const observer = createFileProcessorCrashStageUpdater({ crashLogger: disabled, onStage: stage => stages.push(stage) });
observer('semantic:collect-file:start');
observer('attach-embeddings');
assert.deepEqual(stages, ['semantic:collect-file:start', 'attach-embeddings']);
assert.doesNotThrow(() => createCrashStageUpdater({ onStage: () => { throw new Error('observer failure'); } })('test'));
let updates = 0;
let traces = 0;
const logger = { enabled: true, updateFile: () => { updates += 1; }, traceFileStage: () => { traces += 1; } };
createCrashStageUpdater({ crashLogger: logger, updateFile: false })('pre-cpu');
assert.equal(updates, 0, 'outer trace-only behavior is preserved');
assert.equal(traces, 1);
createFileProcessorCrashStageUpdater({ crashLogger: logger })('cpu');
assert.equal(updates, 1);
assert.equal(traces, 2);
const rows = collectStage1StalledFiles(new Map([[1, { file: 'heavy.ts', startedAt: 100, substage: 'semantic:collect-file:start', substageStartedAt: 500 }]]), { nowMs: 1000 });
assert.equal(rows[0].elapsedMs, 900);
assert.equal(rows[0].substage, 'semantic:collect-file:start');
assert.equal(rows[0].substageElapsedMs, 500);
console.log('existing file trace points feed bounded live-stage observations independently of crash logging');

const { createFileProcessorFixture, createFileProcessorForTest, createScannedFileEntry, writeFixtureFile } =
  await import('./file-processor-fixture.js');
const { repoRoot } = await createFileProcessorFixture('stage-observer');
const target = await writeFixtureFile({ root: repoRoot, rel: 'example.js', contents: 'export const answer = 42;\n' });
const { processFile } = createFileProcessorForTest({ root: repoRoot,
  languageOptions: { treeSitter: { enabled: false } } });
const observed = [];
const result = await processFile(createScannedFileEntry({ abs: target.targetPath, rel: target.rel, stat: target.stat }),
  0, { onStage: stage => observed.push(stage) });
assert.ok(result.chunks.length > 0);
assert.ok(observed.includes('chunking'), 'CPU phase must receive live observer');
assert.ok(observed.length > 4, 'real file processing reports existing trace points with crash logging disabled');
