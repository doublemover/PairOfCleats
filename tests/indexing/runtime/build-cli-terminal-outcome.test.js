import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Writable } from 'node:stream';
import { createBuildIndexOutcome } from '../../../src/integrations/core/build-index/outcome.js';

const coreUrl = new URL('../../../src/integrations/core/index.js', import.meta.url).href;
const hook = registerHooks({ load(url, context, next) {
  if (url === coreUrl) return { format: 'module', shortCircuit: true,
    source: 'export const buildIndex = async () => { if(globalThis.__buildFailure) throw globalThis.__buildFailure; return globalThis.__buildResult; };' };
  return next(url, context);
} });
try {
  const { main } = await import('../../../build_index.js');
  for (const progress of ['jsonl', 'json']) {
    for (const status of ['completed', 'cancelled', 'failed', 'skipped', 'pending', 'not-admitted']) {
      let text = '', output = '';
      const stderr = new Writable({ write(chunk, encoding, callback) { text += chunk; callback(); } });
      const stdout = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });
      const result = { repo: process.cwd(), stage: 'stage3', buildId: 'selected-build', buildRoot: 'C:/selected/build',
        runtimeAttemptId: 'selected-attempt', modes: ['code'], embeddings:
          status === 'cancelled' ? { cancelled: true } : status === 'skipped' ? { skipped: true, reason: 'disabled' }
            : status === 'pending' ? { queued: true, queueId: 'selected-queue' }
              : status === 'not-admitted' ? { notAdmitted: true, reason: 'queue-rejected' } : { inline: true } };
      globalThis.__buildResult = { ...result, outcome: createBuildIndexOutcome({ result }) };
      globalThis.__buildFailure = status === 'failed' ? new Error('owned failure') : null;
      const code = await main({ rawArgs: ['--repo', process.cwd(), '--stage', '3', '--progress', progress], stdout, stderr });
      assert.equal(code, status === 'failed' ? 1 : status === 'cancelled' ? 130 : 0);
      const records = text.trim().split('\n').filter(Boolean).map(JSON.parse);
      const terminal = records.filter(record => record.meta?.kind === 'terminal-outcome');
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].meta.outcome.status, status === 'completed' ? 'stage-completed' : status);
      if (status !== 'failed') {
        assert.equal(terminal[0].meta.outcome.generations[0].buildId, 'selected-build');
        assert.equal(terminal[0].meta.outcome.generations[0].attemptId, 'selected-attempt');
      }
      assert.equal(terminal[0].meta.outcome.counts, null);
      assert.equal(output, '');
    }
  }
  for (const flags of [[], ['--quiet'], ['--verbose'], ['--json']]) {
    const result = { stage: 'stage4', repo: process.cwd(), buildId: 'existing-build', buildRoot: 'C:/existing/build',
      runtimeAttemptId: 'existing-attempt', modes: ['prose'] };
    globalThis.__buildResult = { ...result, outcome: createBuildIndexOutcome({ result }) };
    globalThis.__buildFailure = null;
    let text = '', output = '';
    const stderr = new Writable({ write(chunk, encoding, callback) { text += chunk; callback(); } });
    const stdout = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });
    assert.equal(await main({ rawArgs: ['--repo', process.cwd(), '--stage', '4', '--progress', 'off', ...flags], stdout, stderr }), 0);
    if (flags.includes('--json')) assert.deepEqual(JSON.parse(output), globalThis.__buildResult.outcome);
    else { assert.match(text, /Requested stage completed/); assert.match(text, /C:\/existing\/build\/build_state.json/); }
    assert.doesNotMatch(text + output, /Index built|files indexed|0 files/);
    assert.equal(stderr.listenerCount('error'), 0); assert.equal(stdout.listenerCount('error'), 0);
  }
  for (const mode of ['off', 'jsonl', 'json']) {
    const broken = { destroyed: false, writableEnded: false, write() { throw Object.assign(new Error('closed pipe'), { code: 'EPIPE' }); } };
    assert.equal(await main({ rawArgs: ['--repo', process.cwd(), '--stage', '4', '--progress', mode], stdout: broken, stderr: broken }), 0);
    const destroyed = new Writable({ write(_chunk, _encoding, callback) { callback(); } }); destroyed.destroy();
    assert.equal(await main({ rawArgs: ['--repo', process.cwd(), '--stage', '4', '--progress', mode], stdout: destroyed, stderr: destroyed }), 0);
  }
} finally { delete globalThis.__buildResult; delete globalThis.__buildFailure; hook.deregister(); }
console.log('Actual build CLI emits exactly one framed terminal outcome before closing display.');
