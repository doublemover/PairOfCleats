#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runEmbeddingsTool } from '../../../../src/integrations/core/embeddings.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

applyTestEnv();
assert.deepEqual(await runEmbeddingsTool(['-e', 'process.exit(0)']), { ok: true });
await assert.rejects(
  runEmbeddingsTool(['-e', 'process.stderr.write("synthetic failure"); process.exit(7)']),
  (error) => error.code === 'SUBPROCESS_FAILED'
    && error.result.exitCode === 7
    && /code 7/.test(error.message)
    && /synthetic failure/.test(error.message)
);
if (process.platform !== 'win32') {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    await assert.rejects(
      runEmbeddingsTool(['-e', `process.kill(process.pid, '${signal}')`]),
      (error) => error.code === 'SUBPROCESS_FAILED'
        && error.result.signal === signal
        && error.message.includes(signal),
      `unexpected ${signal} must fail, not become user cancellation`
    );
  }
}
const controller = new AbortController();
await assert.rejects(
  runEmbeddingsTool(['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
    signal: controller.signal,
    onLine: (line) => { if (line === 'ready') controller.abort('requested cancellation'); }
  }),
  (error) => error.name === 'AbortError' || error.code === 'ABORT_ERR'
);
console.log('embedding subprocess outcome tests passed');
