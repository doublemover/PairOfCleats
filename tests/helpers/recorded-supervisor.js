import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createSupervisorSession } from './supervisor-session.js';
import { withTemporaryEnv } from './test-env.js';

/** Generate current publisher bytes through the actual supervisor/child lifecycle. */
export const recordSupervisorFixture = async directory => {
  await fs.mkdir(directory, { recursive: true });
  const runId = 'recorded-session-fixture';
  return withTemporaryEnv({ PAIROFCLEATS_TUI_EVENT_LOG_DIR: directory, PAIROFCLEATS_TUI_RUN_ID: runId }, async () => {
    const session = createSupervisorSession({ timeoutMs: 5000, reassembleEvents: true });
    try {
      await session.waitForEvent(e => e.event === 'hello');
      session.send({ op: 'job:run', jobId: 'recorded-job', title: 'Recorded bounded child',
        command: process.execPath, args: ['-e', 'console.log("recorded alpha");console.log("x".repeat(70000));'] });
      const end = await session.waitForEvent(e => e.event === 'job:end' && e.jobId === 'recorded-job');
      assert.equal(end.status, 'done');
      assert.ok(session.events.some(e => e.event === 'event:chunk'), 'the real publisher must exercise chunked output');
      assert.equal(await session.shutdown(), 0);
      const filename = runId + '.jsonl';
      const bytes = await fs.readFile(path.join(directory, filename));
      const metadataBytes = await fs.readFile(path.join(directory, runId + '.meta.json'));
      return { directory, filename, bytes, metadataBytes, metadata: JSON.parse(metadataBytes),
        frames: bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse) };
    } finally { session.forceKill(); }
  });
};
