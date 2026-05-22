#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createSupervisorFixture,
  findLogArtifacts,
  pathExists,
  readJsonFile,
  removePath,
  resolveLogArtifactPath,
  resolveMetadataEventLogPath,
  resolveSiblingPath
} from './supervisor-fixture.js';

const runId = '../escape-run';
let escapedPath = '';
let fixture;

try {
  fixture = await createSupervisorFixture({
    tempPrefix: 'poc-tui-runid-safe-',
    runId,
    beforeStart: async ({ logDir }) => {
      escapedPath = resolveSiblingPath(logDir, 'escape-run.jsonl');
      await removePath(escapedPath);
    }
  });
  await fixture.waitForEvent((event) => event.event === 'hello');
  await fixture.shutdown();

  assert.equal(pathExists(escapedPath), false, 'runId traversal should not write outside log dir');

  const { jsonl, meta } = await findLogArtifacts(fixture.logDir);
  assert.ok(jsonl, 'expected event log file in configured log dir');
  assert.ok(meta, 'expected session metadata file in configured log dir');

  const metaBody = await readJsonFile(resolveLogArtifactPath(fixture.logDir, meta));
  assert.equal(metaBody.runId, runId, 'metadata should preserve logical runId');
  assert.equal(
    resolveMetadataEventLogPath(metaBody.eventLogPath),
    resolveLogArtifactPath(fixture.logDir, jsonl),
    'metadata should reference the event log file created under the configured log dir'
  );

  console.log('tui run id path safety test passed');
} finally {
  if (fixture) {
    await fixture.cleanup({ extraPaths: [escapedPath] });
  } else if (escapedPath) {
    await removePath(escapedPath);
  }
}
