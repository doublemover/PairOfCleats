import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runEmbeddingsTool } from '../../../../src/integrations/core/embeddings.js';
import { resolveConfirmedCrashEvidencePath } from '../../../../src/index/build/crash-evidence.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
const root = resolveTestCachePath(process.cwd(), `embedding-failure-evidence-${crypto.randomUUID()}`);
try {
  await fs.mkdir(root, { recursive: true });
  const failures = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await runEmbeddingsTool(['-e', 'process.stderr.write("api_key=hidden failure detail"); process.exit(7)'], { repoCacheRoot: root });
      assert.fail('nonzero child must reject');
    } catch (error) {
      assert.equal(error.code, 'SUBPROCESS_FAILED');
      assert.equal(error.result.exitCode, 7);
      const evidencePath = resolveConfirmedCrashEvidencePath(error.diagnosticEvidence);
      assert.ok(evidencePath);
      const payload = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
      assert.equal(payload.error.child.exitCode, 7);
      assert.equal(payload.error.outcome, 'nonzero-exit');
      assert.equal(payload.error.child.pid, error.result.pid);
      assert.match(payload.error.child.stderr.text, /failure detail/);
      assert.equal(JSON.stringify(payload).includes('hidden'), false, 'credential text is redacted in tails and arguments');
      failures.push(error.diagnosticEvidence);
    }
  }
  assert.notEqual(failures[0].attemptId, failures[1].attemptId);
  await fs.access(failures[0].evidencePath);
  const blocked = path.join(root, 'ordinary-file');
  await fs.writeFile(blocked, 'not a directory');
  await assert.rejects(runEmbeddingsTool(['-e', 'process.exit(9)'], { repoCacheRoot: blocked }), error =>
    error.code === 'SUBPROCESS_FAILED' && error.result.exitCode === 9
    && error.diagnosticEvidence.written === false && Boolean(error.diagnosticEvidence.writeError));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('embedding child failure evidence passed');
