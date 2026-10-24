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
    for (const status of ['completed', 'cancelled', 'failed']) {
      let text = '', output = '';
      const stderr = new Writable({ write(chunk, encoding, callback) { text += chunk; callback(); } });
      const stdout = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });
      const result = { repo: process.cwd(), stage: 'stage3', embeddings: status === 'cancelled' ? { cancelled: true } : { inline: true } };
      globalThis.__buildResult = { ...result, outcome: createBuildIndexOutcome({ result }) };
      globalThis.__buildFailure = status === 'failed' ? new Error('owned failure') : null;
      const code = await main({ rawArgs: ['--repo', process.cwd(), '--stage', '3', '--progress', progress], stdout, stderr });
      assert.equal(code, status === 'completed' ? 0 : status === 'cancelled' ? 130 : 1);
      const records = text.trim().split('\n').filter(Boolean).map(JSON.parse);
      const terminal = records.filter(record => record.meta?.kind === 'terminal-outcome');
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].meta.outcome.status, status === 'completed' ? 'stage-completed' : status);
      assert.equal(output, '');
    }
  }
} finally { delete globalThis.__buildResult; delete globalThis.__buildFailure; hook.deregister(); }
console.log('Actual build CLI emits exactly one framed terminal outcome before closing display.');
