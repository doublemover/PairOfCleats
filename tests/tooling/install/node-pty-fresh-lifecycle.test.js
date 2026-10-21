import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const caseId = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/node-pty-fresh-lifecycle/')[1];
assert.match(caseId || '', /^fresh-(0[1-9]|10)$/);
const { dir } = await prepareIsolatedTestCacheDir(`node-pty-${caseId}`);
const result = await spawnSubprocess(process.execPath, [path.join(process.cwd(), 'tests/fixtures/tui/node-pty-lifecycle.js'), caseId],
  { cwd: process.cwd(), env: process.env, timeoutMs: 5000, maxOutputBytes: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
await fs.writeFile(path.join(dir, `${caseId}.json`), JSON.stringify(result, null, 2));
assert.equal(result.exitCode, 0, `${caseId}: ${result.stderr}`); assert.equal(result.stderr, '');
const receipt = JSON.parse(result.stdout); assert.equal(receipt.caseId, caseId); assert.equal(receipt.records.length, 3);
for (const record of receipt.records) assert.equal(isProcessAlive(record.pid), false, `Owned PTY child ${record.pid} survived`);
console.log(`${caseId}: a recorded fresh process completed two natural real PTYs and one owned cancellation, without retries.`);
