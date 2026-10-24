import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { SEARCH_VALUE_FLAGS } from '../../../../src/retrieval/cli-options.js';

export const assertMissingValueFlags = (partition, count = 4) => {
  const root = process.cwd(), env = applyTestEnv({ syncProcess: false });
  const flags = [...SEARCH_VALUE_FLAGS].sort();
  assert.ok(flags.length > 0 && partition >= 0 && partition < count);
  const selectedFlags = flags.filter((_flag, index) => index % count === partition);
  const cases = selectedFlags.map(flag => flag.slice(2));
  const inventory = new URL(`../missing-value-flags-${partition + 1}.test.js.cases.json`, import.meta.url);
  assert.deepEqual(JSON.parse(fs.readFileSync(inventory, 'utf8')), { schemaVersion: 1, cases },
    'every original missing-value command must retain a discovered process boundary');
  const prefix = `cli/search/missing-value-flags-${partition + 1}/`;
  const id = process.env.PAIROFCLEATS_TEST_ID;
  const selected = typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : null;
  assert.ok(cases.includes(selected), 'run one independently bounded missing-value command');
  const flag = selectedFlags[cases.indexOf(selected)];
  const result = runNode([path.join(root, 'search.js'), 'test', flag],
    'missing search value ' + flag, root, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
  assert.notEqual(result.status, 0, 'expected non-zero exit for ' + flag);
  assert.ok((result.stdout + result.stderr).includes('Missing value for ' + flag), flag);
  return flag;
};
