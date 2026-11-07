import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { rmDirRecursive } from '../helpers/temp.js';

const root = fileURLToPath(new URL('../../', import.meta.url)), runner = path.join(root, 'tests', 'run.js');
const scope = path.join(root, '.tmp', 'tests', 'list-import-boundary');
assertNoSymlinkPath(root, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), harness = path.join(temporary, 'child.mjs');
const denied = ['tests/runner/run-execution.js', 'tests/runner/run-reporting.js', 'tests/runner/run-stability.js',
  'tools/testing/coverage/index.js', 'src/contracts/validators/test-artifacts.js'].map(relative => new URL('../../' + relative, import.meta.url).href);
try {
  await fs.writeFile(harness, `import {registerHooks} from 'node:module';
    const denied=new Set(${JSON.stringify(denied)});
    registerHooks({resolve(specifier,context,next){const result=next(specifier,context);
      if(denied.has(result.url))throw Object.assign(new Error('ERR_FIXTURE_EXECUTION_IMPORT '+result.url),{code:'ERR_FIXTURE_EXECUTION_IMPORT'});
      return result;}});
    process.argv=[process.execPath,${JSON.stringify(runner)},...process.argv.slice(2)];
    await import(${JSON.stringify(new URL('../run.js', import.meta.url).href)});
  `);
  const env = applyTestEnv({ cacheRoot: path.join(temporary, 'cache'), syncProcess: false });
  const id = 'runner/list-runtime-import-boundary';
  const selectors = ['--lane', 'all', '--match', id];
  const plain = runNode([harness, ...selectors, '--list'], 'plain discovery excludes execution owners', root, env,
    { stdio: 'pipe', timeoutMs: 30000 });
  assert.equal(plain.stdout.trim(), id);
  const json = runNode([harness, ...selectors, '--list', '--json'], 'structured discovery excludes execution owners', root, env,
    { stdio: 'pipe', timeoutMs: 30000 });
  const listed = JSON.parse(json.stdout); assert.equal(listed.total, 1); assert.equal(listed.tests[0].id, id);
  assert.equal(typeof listed.tests[0].selectionSource, 'string'); assert.ok(listed.suiteCategorySummary);
  const actual = runNode([harness, ...selectors, '--jobs', '1', '--timeout-ms', '30000', '--retries', '0', '--native-status-redo=false'],
    'actual execution must activate its original owners', root, env, { stdio: 'pipe', timeoutMs: 30000, allowFailure: true });
  assert.equal(actual.status, 1); assert.match(actual.stderr, /ERR_FIXTURE_EXECUTION_IMPORT/);
} finally {
  assertNoSymlinkPath(root, temporary);
  assert.equal(path.dirname(await fs.realpath(temporary)), await fs.realpath(scope)); await rmDirRecursive(temporary, { retries: 0 });
}
console.log('Actual plain/structured discovery preserves selection without activating execution/reporting modules.');
