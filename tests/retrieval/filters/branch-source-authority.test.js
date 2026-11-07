import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyBranchFilter, resolveRepoBranch } from '../../../src/retrieval/cli/branch-filter.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { renderSearchOutputForTest } from '../helpers/search-output-fixture.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-branch-authority-'));
const originalRunner = getScmCommandRunner(), originalGitDir = process.env.GIT_DIR;
const revision = 'a'.repeat(40);
let calls = 0, response = { exitCode: 0, stdout: `${revision}\nrefs/heads/current-B\n` };
try {
  for (const [mode, branch] of [['code', 'stale-A'], ['prose', 'stale-C']]) {
    await fs.writeFile(path.join(root, `index-${mode}.json`), JSON.stringify({ git: { branch } }));
  }
  process.env.GIT_DIR = path.join(root, 'must-not-redirect');
  setScmCommandRunner(async (command, args, options) => {
    calls++;
    assert.equal(command, 'git');
    assert.deepEqual(args, ['-C', root, 'rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD']);
    assert.equal(options.timeoutMs, 3000); assert.equal(options.maxOutputBytes, 4096);
    assert.equal(Object.keys(options.env).some(key => /^GIT_/i.test(key)), false);
    if (response instanceof Error) throw response;
    return response;
  });
  for (const historical of [false, true]) {
    const before = calls;
    const result = await applyBranchFilter({ root, metricsDir: root, runCode: true, runProse: true,
      branchFilter: 'current-B', asOfContext: historical ? { ref: 'old-build' } : null });
    assert.equal(calls, before + 1, 'one bounded current-checkout observation per requested predicate');
    assert.equal(result.matched, true);
    assert.deepEqual(result.receipt, { requested: 'current-B', observed: 'current-B', basis: 'current-checkout',
      revision, state: 'verified', reason: null });
    const payload = renderSearchOutputForTest({ branchQualification: result.receipt, explain: false });
    assert.deepEqual(payload.stats.branchQualification, result.receipt, 'ordinary structured output retains current-source qualification');
    const budgeted = renderSearchOutputForTest({ branchQualification: result.receipt, explain: false,
      outputBudget: { totalMaxBytes: 8192, maxBytes: 1, maxFields: 1 } });
    assert.deepEqual(budgeted.stats.branchQualification, result.receipt, 'compaction cannot truncate the required receipt');
    assert.throws(() => renderSearchOutputForTest({ branchQualification: result.receipt,
      outputBudget: { totalMaxBytes: 1 } }), /Output budget/);
  }
  const mismatch = await applyBranchFilter({ root, branchFilter: 'stale-A', emitOutput: false });
  assert.equal(mismatch.matched, false); assert.equal(mismatch.payload.stats.branchQualification.state, 'mismatch');
  for (const [result, reason] of [
    [{ exitCode: 128, stdout: '' }, 'unavailable'],
    [{ exitCode: 0, stdout: `${revision}\nHEAD\n` }, 'detached'],
    [{ exitCode: 0, stdout: 'unqualified output' }, 'invalid-observation'],
    [{ exitCode: 0, stdout: `${revision}\nrefs/heads/current-B\n`, outputCapture: { stdout: { truncated: true } } }, 'invalid-observation'],
    [new Error('controlled SCM timeout after actual child settlement'), 'unavailable']
  ]) {
    response = result;
    await assert.rejects(applyBranchFilter({ root, branchFilter: 'current-B' }), error =>
      error.code === 'CAPABILITY_MISSING' && error.details.branchQualification.state === 'unavailable'
      && error.details.branchQualification.reason === reason);
  }
  const controller = new AbortController(); controller.abort();
  const before = calls;
  await assert.rejects(resolveRepoBranch({ root, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, before, 'pre-abort admits no SCM operation');
  const during = new AbortController(), cancellation = Object.assign(new Error('original cancellation'), { name: 'AbortError', code: 'ABORT_ERR' });
  setScmCommandRunner(async () => { during.abort(cancellation); throw cancellation; });
  await assert.rejects(resolveRepoBranch({ root, signal: during.signal }), { name: 'AbortError' });
} finally {
  setScmCommandRunner(originalRunner);
  if (originalGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = originalGitDir;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Branch predicates use bounded current-checkout authority and retain structured qualification.');
