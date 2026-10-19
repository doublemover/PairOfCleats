import assert from 'node:assert/strict';
import path from 'node:path';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { SEARCH_VALUE_FLAGS } from '../../../../src/retrieval/cli-args.js';

export const assertMissingValueFlags = (partition, count = 4) => {
  const root = process.cwd(), env = applyTestEnv({ syncProcess: false });
  const flags = [...SEARCH_VALUE_FLAGS].sort();
  assert.ok(flags.length > 0 && partition >= 0 && partition < count);
  for (const [index, flag] of flags.entries()) {
    if (index % count !== partition) continue;
    const result = runNode([path.join(root, 'search.js'), 'test', flag],
      'missing search value ' + flag, root, env,
      { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    assert.notEqual(result.status, 0, 'expected non-zero exit for ' + flag);
    assert.ok((result.stdout + result.stderr).includes('Missing value for ' + flag), flag);
  }
};
