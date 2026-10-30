import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/index-stats/option-admission/')[1];
const cases = {
  conflict: { args: ['--repo=missing-repository', '--index-dir=missing-index'], expected: /Use either --repo or --index-dir, not both/ },
  missing: { args: [], expected: /index stats requires --repo <path> or --index-dir <path>/ },
  'invalid-mode': { args: ['--repo=missing-repository', '--mode=unrecognized'], expected: /Invalid --mode unrecognized\. Use code\|prose\|extracted-prose\|records/ }
};
assert.ok(Object.hasOwn(cases, mode), `Unknown case ${mode}`);
const { dir } = await prepareIsolatedTestCacheDir(`index-stats-option-${mode}`);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: false,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const result = await spawnSubprocess(process.execPath, [path.resolve('bin/pairofcleats.js'), 'index', 'stats', ...cases[mode].args, '--json'],
  { cwd: dir, env, timeoutMs: 10000, maxOutputBytes: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
assert.equal(result.exitCode, 1, JSON.stringify(result));
assert.equal(result.stdout, '', 'invalid options must not produce a success payload');
assert.match(result.stderr, cases[mode].expected, 'canonical consumer rejects options before inspecting missing inputs');
console.log(`index stats canonical option admission: ${mode}`);
